import { t } from '../../i18n'
import { useMedia } from '../../store'
import ReviewComments from './ReviewComments'
import ReviewText from './ReviewText'
import Sheet from './Sheet'

/** Commentaires sous un de mes avis, en plein écran (ouvert depuis une notification). */
export default function CommentsSheet({ authorId, itemId, title, onClose }: { authorId: string; itemId: string; title: string; onClose: () => void }) {
  const { items } = useMedia()
  // Mon avis tel qu'il est sur cet appareil (les commentaires viennent du serveur)
  const mine = items.find((i) => i.id === itemId)
  return (
    <Sheet title={title || t('comments.title')} label={t('comments.title')} onClose={onClose} elevated>
      <div className="px-4 pt-4">
        {mine?.notes && (
          <article className="card mb-4 p-3.5">
            <p className="eyebrow">{t('form.review')}</p>
            <ReviewText text={mine.notes} spoiler={mine.notesSpoiler} revealed clamp />
          </article>
        )}
        <p className="eyebrow mb-1">{t('comments.title')}</p>
        <ReviewComments authorId={authorId} itemId={itemId} defaultOpen />
      </div>
    </Sheet>
  )
}
