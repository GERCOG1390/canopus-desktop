import { useState } from 'react'
import { useApp } from '../../AppContext'
import { RequireLogin, Tabs } from '../../components/ui'
import AllCharacters from './AllCharacters'
import Assets from './Assets'
import Blueprints from './Blueprints'
import Clones from './Clones'
import Contracts from './Contracts'
import Contacts from './Contacts'
import Calendar from './Calendar'
import Fittings from './Fittings'
import Overview from './Overview'
import Wealth from './Wealth'
import Reputation from './Reputation'
import Skills from './Skills'
import SkillPlanner from './SkillPlanner'
import Wallet from './Wallet'

type Tab = 'all' | 'overview' | 'wealth' | 'skills' | 'plan' | 'clones' | 'fits' | 'assets' | 'blueprints' | 'wallet' | 'contracts' | 'contacts' | 'calendar' | 'reputation'

const TABS: { id: Tab; label: string; group: string }[] = [
  { id: 'overview', label: 'Обзор', group: 'Обзор' },
  { id: 'all', label: 'Все персонажи', group: 'Обзор' },
  { id: 'skills', label: 'Навыки', group: 'Развитие' },
  { id: 'plan', label: 'План навыков', group: 'Развитие' },
  { id: 'clones', label: 'Импланты и клоны', group: 'Развитие' },
  { id: 'fits', label: 'Корабль и фиты', group: 'Имущество' },
  { id: 'assets', label: 'Ассеты', group: 'Имущество' },
  { id: 'blueprints', label: 'Чертежи', group: 'Имущество' },
  { id: 'wallet', label: 'Кошелёк', group: 'Деньги' },
  { id: 'wealth', label: 'Капитал', group: 'Деньги' },
  { id: 'contracts', label: 'Мои контракты', group: 'Деньги' },
  { id: 'contacts', label: 'Контакты', group: 'Связи' },
  { id: 'reputation', label: 'Репутация', group: 'Связи' },
  { id: 'calendar', label: 'Календарь', group: 'Связи' }
]

export default function CharacterPage() {
  const { active, setActive } = useApp()
  const [tab, setTab] = useState<Tab>('overview')
  if (!active) return <RequireLogin what="данные персонажа" />
  const id = active.id

  return (
    <div className="page">
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'all' && (
        <AllCharacters
          onOpen={(cid) => {
            void setActive(cid)
            setTab('overview')
          }}
        />
      )}
      {tab === 'overview' && <Overview id={id} />}
      {tab === 'wealth' && <Wealth id={id} />}
      {tab === 'skills' && <Skills />}
      {tab === 'plan' && <SkillPlanner />}
      {tab === 'clones' && <Clones id={id} />}
      {tab === 'fits' && <Fittings id={id} />}
      {tab === 'assets' && <Assets id={id} />}
      {tab === 'blueprints' && <Blueprints id={id} />}
      {tab === 'wallet' && <Wallet id={id} />}
      {tab === 'contracts' && <Contracts id={id} />}
      {tab === 'contacts' && <Contacts id={id} />}
      {tab === 'calendar' && <Calendar id={id} />}
      {tab === 'reputation' && <Reputation id={id} />}
    </div>
  )
}

/** Explains a missing ESI scope (the token predates the scope or the app lacks it). */
export function ScopeHint({ scope }: { scope: string }) {
  const { active } = useApp()
  const has = active?.scopes.includes(scope)
  return (
    <div className="warn">
      Нет доступа к этим данным.{' '}
      {has ? 'ESI отказал в доступе.' : <>Токену не хватает разрешения <code>{scope}</code>: войдите этим персонажем заново в «Настройках» — новый токен получит все разрешения.</>}
    </div>
  )
}
