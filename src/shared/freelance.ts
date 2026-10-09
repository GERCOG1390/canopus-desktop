// Freelance Jobs: the saved filter for the job board and its alerts.

export interface FreelanceFilter {
  text: string
  /** Careers to show (Industrialist, Enforcer, Explorer, Soldier of Fortune…); empty = all */
  careers: string[]
  /** Job types (DeliverItem, MineOre, KillNPC…); empty = all */
  methods: string[]
  /** Minimum ISK per unit of contribution */
  minReward: number
  /** Corporations whose jobs are hidden, by name, any number */
  excludeCorps: string[]
  /** Only jobs broadcast within this many jumps of the current system; 0 = anywhere */
  maxJumps: number
  /** Notify (and post to the intel Discord webhook) when a new job matches */
  notify: boolean
}

export const DEFAULT_FREELANCE: FreelanceFilter = { text: '', careers: [], methods: [], minReward: 0, excludeCorps: [], maxJumps: 0, notify: false }

export interface FreelanceJob {
  id: string
  name: string
  state: string
  /** ESI leaves these out on some jobs */
  progress?: { current: number; desired: number }
  reward?: { initial: number; remaining: number }
  details?: {
    description?: string
    career?: string
    created?: string
    expires?: string
    creator?: { character?: { id: number; name: string }; corporation?: { id: number; name: string } }
  }
  configuration?: { method?: string }
  contribution?: { reward_per_contribution?: number; max_committed_participants?: number }
  access_and_visibility?: { broadcast_locations?: { id: number; name: string }[] }
}

/** Whether a job passes the filter (jumps are checked separately: they need the current system). */
export function matchesFreelance(job: FreelanceJob, f: FreelanceFilter): boolean {
  const corp = job.details?.creator?.corporation?.name ?? ''
  if (f.text && !`${job.name} ${job.details?.description ?? ''} ${corp}`.toLowerCase().includes(f.text.toLowerCase())) return false
  if (f.careers.length && !f.careers.includes(job.details?.career ?? '')) return false
  if (f.methods.length && !f.methods.includes(job.configuration?.method ?? '')) return false
  if ((job.contribution?.reward_per_contribution ?? 0) < f.minReward) return false
  if (f.excludeCorps.some((c) => c.trim() && corp.toLowerCase() === c.trim().toLowerCase())) return false
  return true
}
