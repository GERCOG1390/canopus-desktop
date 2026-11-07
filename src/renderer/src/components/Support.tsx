// Supporting Canopus: a voluntary ISK donation to the author's character in the game. Nothing in the app
// depends on it (CCP's Developer License, section 4.4, allows ISK donations; the app stays the same for
// everyone). The card sits in Settings; the heart in the sidebar opens the same thing as a dialog.

import { Glyph } from './Glyph'
import { useEffect, useState } from 'react'
import { imageUrl } from '../lib/esi'
import { openInfoInGame, SCOPE } from '../lib/gameActions'
import { GameButton } from './GameButton'
import { Card } from './ui'

/** The character donations go to. */
export const AUTHOR = { id: 92260358, name: 'Alexandr Gercog' }

function SupportBody() {
  const [copied, setCopied] = useState(false)
  function copy() {
    void navigator.clipboard.writeText(AUTHOR.name)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="support">
      <div className="support-head">
        <img src={imageUrl.portrait(AUTHOR.id, 128)} width={72} height={72} alt="" />
        <div>
          <div className="support-name" translate="no">
            {AUTHOR.name}
          </div>
          <div className="muted small">Автор Canopus</div>
        </div>
      </div>
      <p>
        Canopus бесплатен и останется бесплатным — без рекламы, подписок и платных функций. Если он экономит вам время или ISK, можно отправить автору любую сумму ISK в
        игре. Каждый перевод помогает развивать приложение — спасибо!
      </p>
      <ol className="support-steps">
        <li>Нажмите «Открыть в игре» — в клиенте откроется карточка персонажа (или найдите его по имени).</li>
        <li>Правый клик по портрету → «Give Money» (передать ISK).</li>
        <li>В комментарии к переводу напишите «Canopus».</li>
      </ol>
      <div className="row">
        <GameButton scope={SCOPE.openWindow} action={(who) => openInfoInGame(who, AUTHOR.id)} title="Открыть карточку персонажа в клиенте игры" done="открыто в игре" className="">
          Открыть в игре
        </GameButton>
        <button className="ghost" onClick={copy}>
          {copied ? 'Имя скопировано' : 'Копировать имя'}
        </button>
      </div>
      <p className="muted small">Пожертвование добровольное: все функции Canopus работают одинаково для всех.</p>
      <p className="muted small support-ccp">
        © CCP hf. All rights reserved. &quot;EVE&quot;, &quot;EVE Online&quot;, &quot;CCP&quot; and all related logos and images are trademarks or registered trademarks of CCP hf.
        Canopus is a third-party application and is not affiliated with or endorsed by CCP hf.
      </p>
    </div>
  )
}

export function SupportCard() {
  return (
    <Card title="Поддержать Canopus">
      <SupportBody />
    </Card>
  )
}

export function SupportDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <div className="palette-backdrop relogin-backdrop" onClick={onClose}>
      <div className="palette relogin support-dialog" role="dialog" aria-modal="true" aria-labelledby="support-title" onClick={(e) => e.stopPropagation()}>
        <div className="support-title-row">
          <h2 id="support-title">Поддержать Canopus</h2>
          <button className="ghost small" onClick={onClose} aria-label="Закрыть">
            <Glyph name="close" size={14} />
          </button>
        </div>
        <SupportBody />
      </div>
    </div>
  )
}
