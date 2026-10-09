-- ════════════════════════════════════════════════════════════════════════════
-- AzuuCine — Notifications push (Web Push), même app fermée (9 octobre 2026)
--  1. push_subscriptions : les appareils où chacun a activé les notifications.
--  2. Inscription / désinscription sûres (hôtes des services push connus uniquement : anti-SSRF).
--  3. À chaque nouvelle notification (cloche), la base appelle la fonction serveur « send-push »
--     (extension pg_net), avec un secret partagé lu dans Supabase Vault (jamais écrit ici).
--
-- Prérequis : 20261007120000_social_notifications.sql appliqué.
-- À coller dans Supabase → SQL Editor → Run. Idempotent (réexécutable sans risque).
-- Étapes manuelles (secrets, Vault, déploiement) : voir supabase/PUSH_SETUP.md
-- ════════════════════════════════════════════════════════════════════════════

-- pg_net : appels HTTP asynchrones depuis la base (envoyés après la validation de la transaction)
create extension if not exists pg_net;

-- ── Abonnements push (un par appareil / navigateur) ──
create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 20 and 1024),
  p256dh text not null check (p256dh ~ '^B[A-Za-z0-9_-]{86}=?$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{22}(==)?$'),
  -- Langue des messages envoyés à cet appareil
  lang text not null default 'fr' check (lang in ('fr','en','es','it','de','pt','nl','pl','ru','tr','ar','hi','id','th','vi','zh','ja','ko')),
  -- Petit libellé de l'appareil (« Chrome · Android »), pour s'y retrouver
  user_agent text check (user_agent is null or char_length(user_agent) <= 60),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;

-- Chacun ne voit / supprime que ses propres appareils (l'ajout passe par la fonction ci-dessous)
drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));

-- ── Notifications : marque « déjà envoyée en push » ──
alter table public.notifications add column if not exists pushed_at timestamptz;
create index if not exists notifications_unpushed_idx on public.notifications (user_id, created_at) where pushed_at is null;
-- L'historique existant n'est jamais envoyé en push
update public.notifications set pushed_at = created_at
where pushed_at is null and created_at < now() - interval '15 minutes';

-- ── Inscription d'un appareil ──
create or replace function public.register_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_lang text default 'fr', p_ua text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  v_host text;
  v_lang text;
  v_ua text;
begin
  if me is null then raise exception 'auth'; end if;

  -- Adresse d'envoi : https uniquement, vers un service push connu (sinon le serveur pourrait
  -- être utilisé pour contacter n'importe quelle adresse : SSRF)
  if p_endpoint is null or char_length(p_endpoint) > 1024
     or p_endpoint !~ '^https://[A-Za-z0-9.-]+(:443)?/[^[:space:]]*$' then
    raise exception 'bad endpoint';
  end if;
  v_host := lower(substring(p_endpoint from '^https://([A-Za-z0-9.-]+)'));
  if not (
    v_host in ('fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com')
    or v_host ~ '^([a-z0-9-]{1,63}\.)+push\.apple\.com$'
    or v_host ~ '^([a-z0-9-]{1,63}\.)+notify\.windows\.com$'
  ) then
    raise exception 'push service not allowed';
  end if;
  if p_p256dh is null or p_p256dh !~ '^B[A-Za-z0-9_-]{86}=?$' then raise exception 'bad key'; end if;
  if p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{22}(==)?$' then raise exception 'bad auth'; end if;

  v_lang := case when p_lang in ('fr','en','es','it','de','pt','nl','pl','ru','tr','ar','hi','id','th','vi','zh','ja','ko') then p_lang else 'fr' end;
  v_ua := nullif(left(regexp_replace(coalesce(p_ua, ''), '[^A-Za-z0-9 ._()/·-]', '', 'g'), 60), '');

  -- Anti-abus : 10 nouveaux appareils max en 10 minutes
  if (select count(*) from public.push_subscriptions s
      where s.user_id = me and s.created_at > now() - interval '10 minutes') >= 10 then
    raise exception 'rate';
  end if;

  -- Même navigateur réinscrit (ou changement de compte sur l'appareil) : on met à jour.
  -- Un abonnement d'un autre compte n'est repris que si l'on prouve le posséder (mêmes clés).
  insert into public.push_subscriptions as s (user_id, endpoint, p256dh, auth, lang, user_agent, last_used_at)
  values (me, p_endpoint, p_p256dh, p_auth, v_lang, v_ua, now())
  on conflict (endpoint) do update
    set user_id = me, p256dh = excluded.p256dh, auth = excluded.auth, lang = excluded.lang,
        user_agent = excluded.user_agent, last_used_at = now()
    where s.user_id = me or (s.p256dh = excluded.p256dh and s.auth = excluded.auth);
  if not found then raise exception 'endpoint taken'; end if;

  -- 10 appareils max par compte : les plus anciens sont retirés
  delete from public.push_subscriptions
  where user_id = me and id not in (
    select id from public.push_subscriptions where user_id = me
    order by coalesce(last_used_at, created_at) desc limit 10
  );
  return jsonb_build_object('ok', true);
end;
$$;

-- ── Désinscription d'un appareil ──
create or replace function public.unregister_push_subscription(p_endpoint text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'auth'; end if;
  delete from public.push_subscriptions where user_id = auth.uid() and endpoint = p_endpoint;
  return jsonb_build_object('ok', true);
end;
$$;

-- ── Fonction serveur (service_role) : prend les notifications à envoyer d'un compte ──
-- Les notifications arrivées ensemble (plusieurs épisodes) sont prises d'un coup, ce qui permet
-- de les regrouper ; une notification n'est prise qu'une seule fois (pushed_at).
create or replace function public.push_claim(p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare res jsonb;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'forbidden'; end if;
  with claimed as (
    update public.notifications n set pushed_at = now()
    where n.user_id = p_user and n.pushed_at is null and n.read_at is null
      and n.created_at > now() - interval '15 minutes'
    returning n.id, n.user_id, n.kind, n.actor_id, n.item_id, n.emoji, n.episode, n.ep_count, n.created_at
  )
  select jsonb_build_object(
    'subs', coalesce((
      select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'lang', s.lang))
      from public.push_subscriptions s where s.user_id = p_user), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'kind', c.kind, 'emoji', c.emoji, 'item_id', c.item_id,
        'episode', c.episode, 'ep_count', c.ep_count,
        'actor', case when p.id is null then null
                 else jsonb_build_object('username', p.username, 'display_name', p.display_name) end,
        'title', case when c.kind = 'shared_list_invite'
                   then (select l.name from public.shared_lists l where l.id::text = c.item_id)
                   else (select it.data->>'title' from public.items it where it.user_id = c.user_id and it.id = c.item_id) end
      ) order by c.created_at)
      from claimed c left join public.profiles p on p.id = c.actor_id
      where public.azuu_wants(c.user_id, c.kind)), '[]'::jsonb)
  ) into res;
  return res;
end;
$$;

-- ── Fonction serveur (service_role) : bilan d'un envoi ──
create or replace function public.push_done(p_user uuid, p_gone text[], p_ok text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'forbidden'; end if;
  -- Abonnements expirés (404 / 410) : supprimés
  delete from public.push_subscriptions where user_id = p_user and endpoint = any(coalesce(p_gone, '{}'));
  update public.push_subscriptions set last_used_at = now()
  where user_id = p_user and endpoint = any(coalesce(p_ok, '{}'));
end;
$$;

-- ── Déclencheur : nouvelle notification → appel de « send-push » ──
-- Adresse et secret dans Vault (voir PUSH_SETUP.md) :
--   azuu_push_url    = https://<ref>.supabase.co/functions/v1/send-push
--   azuu_push_secret = la même valeur que le secret PUSH_WEBHOOK_SECRET de la fonction
-- Un seul appel par compte et par transaction (plusieurs épisodes d'un coup = 1 appel, regroupé).
-- Toute erreur (pg_net absent, Vault vide…) est ignorée : la notification reste dans la cloche.
create or replace function public.azuu_push_dispatch()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
  v_flag text := 'azuu.push_' || replace(new.user_id::text, '-', '');
begin
  if not exists (select 1 from public.push_subscriptions s where s.user_id = new.user_id) then return null; end if;
  if current_setting(v_flag, true) = '1' then return null; end if;
  begin
    select ds.decrypted_secret into v_url from vault.decrypted_secrets ds where ds.name = 'azuu_push_url' limit 1;
    select ds.decrypted_secret into v_secret from vault.decrypted_secrets ds where ds.name = 'azuu_push_secret' limit 1;
    if v_url is null or v_secret is null or char_length(v_secret) < 32
       or v_url !~ '^https://[A-Za-z0-9.-]+/functions/v1/send-push$' then
      return null;
    end if;
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('user_id', new.user_id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
      timeout_milliseconds := 10000
    );
    perform set_config(v_flag, '1', true);
  exception when others then
    null;
  end;
  return null;
end;
$$;
drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
  for each row execute function public.azuu_push_dispatch();

-- ── Droits ──
revoke all on function public.register_push_subscription(text, text, text, text, text) from public, anon;
revoke all on function public.unregister_push_subscription(text) from public, anon;
revoke all on function public.push_claim(uuid) from public, anon, authenticated;
revoke all on function public.push_done(uuid, text[], text[]) from public, anon, authenticated;
revoke all on function public.azuu_push_dispatch() from public, anon, authenticated;
grant execute on function public.register_push_subscription(text, text, text, text, text) to authenticated;
grant execute on function public.unregister_push_subscription(text) to authenticated;
grant execute on function public.push_claim(uuid) to service_role;
grant execute on function public.push_done(uuid, text[], text[]) to service_role;
