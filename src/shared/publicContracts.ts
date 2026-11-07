// Public contracts of a region: which to look inside (ESI lists them without contents, one request each) and
// what a contract is really worth against Jita.

export interface PublicContract {
  contract_id: number
  type: string
  title?: string
  price?: number
  buyout?: number
  volume?: number
  date_issued: string
  date_expired: string
  start_location_id?: number
}

export interface PublicContractItem {
  type_id: number
  quantity: number
  /** false: the issuer asks for it rather than offering it */
  is_included: boolean
  is_blueprint_copy?: boolean
}

export interface ContractFilter {
  kind: 'any' | 'item_exchange' | 'auction'
  minPrice: number
  /** 0: no upper limit */
  maxPrice: number
  title: string
  /** Now, ms */
  now: number
}

/** Contracts worth opening, newest first; couriers carry nothing for sale. */
export function pickContracts(list: PublicContract[], f: ContractFilter): PublicContract[] {
  const title = f.title.trim().toLowerCase()
  return list
    .filter((c) => {
      if (c.type !== 'item_exchange' && c.type !== 'auction') return false
      if (f.kind !== 'any' && c.type !== f.kind) return false
      if (Date.parse(c.date_expired) <= f.now) return false
      const price = c.price ?? 0
      if (price < f.minPrice) return false
      if (f.maxPrice > 0 && price > f.maxPrice) return false
      return !title || (c.title ?? '').toLowerCase().includes(title)
    })
    .sort((a, b) => Date.parse(b.date_issued) - Date.parse(a.date_issued))
}

/** Whether the contract sells this item, not merely asks for it. */
export function sells(items: PublicContractItem[], typeId: number): boolean {
  return items.some((i) => i.is_included && i.type_id === typeId)
}

export interface ContractDeal {
  /** What is offered, at Jita */
  value: number
  /** What the issuer wants on top of the price, at Jita */
  asked: number
  /** Price plus the items asked for */
  cost: number
  /** value − cost */
  gain: number
  /** Offered items with no price at Jita, blueprint copies among them: the value leaves them out */
  unpriced: number
}

export function dealOf(contract: PublicContract, items: PublicContractItem[], price: (id: number) => number): ContractDeal {
  let value = 0
  let asked = 0
  let unpriced = 0
  for (const i of items) {
    const unit = i.is_blueprint_copy ? 0 : price(i.type_id)
    if (i.is_included) {
      value += unit * i.quantity
      if (unit <= 0) unpriced++
    } else {
      asked += unit * i.quantity
    }
  }
  // An auction is won at its buyout at most; without one, the opening bid is only where it starts.
  const pay = contract.type === 'auction' && contract.buyout ? contract.buyout : (contract.price ?? 0)
  const cost = pay + asked
  return { value, asked, cost, gain: value - cost, unpriced }
}
