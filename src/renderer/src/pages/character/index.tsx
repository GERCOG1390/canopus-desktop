import { useState } from 'react'
import { useApp } from '../../AppContext'
import { RequireLogin, Tabs } from '../../components/ui'
import Assets from './Assets'
import Blueprints from './Blueprints'
import Clones from './Clones'
import Contracts from './Contracts'
import Contacts from './Contacts'
import Calendar from './Calendar'
import Fittings from './Fittings'
import Overview from './Overview'
import Reputation from './Reputation'
import Skills from './Skills'
import SkillPlanner from './SkillPlanner'
import Wallet from './Wallet'

type Tab = 'overview' | 'skills' | 'plan' | 'clones' | 'fits' | 'assets' | 'blueprints' | 'wallet' | 'contracts' | 'contacts' | 'calendar' | 'reputation'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Обзор' },
  { id: 'skills', label: 'Навыки' },
  { id: 'plan', label: 'План навыков' },
  { id: 'clones', label: 'Импланты и клоны' },
  { id: 'fits', label: 'Корабль и фиты' },
  { id: 'assets', label: 'Ассеты' },
  { id: 'blueprints', label: 'Чертежи' },
  { id: 'wallet', label: 'Кошелёк' },
  { id: 'contracts', label: 'Контракты' },
  { id: 'contacts', label: 'Контакты' },
  { id: 'calendar', label: 'Календарь' },
  { id: 'reputation', label: 'Репутация' }
]

export default function CharacterPage() {
  const { active } = useApp()
  const [tab, setTab] = useState<Tab>('overview')
  if (!active) return <RequireLogin what="данные персонажа" />
  const id = active.id

  return (
    <div className="page">
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'overview' && <Overview id={id} />}
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
