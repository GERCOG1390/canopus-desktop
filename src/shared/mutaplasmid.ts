// Mutaplasmid rolls: each attribute lands somewhere between the mutaplasmid's multipliers of the module's
// own value. `roll` is where it landed, 0 at the lower multiplier and 1 at the higher.

export const rolledValue = (base: number, min: number, max: number, roll: number): number => base * (min + (max - min) * roll)

export const isBetter = (value: number, base: number, highIsGood: boolean): boolean => (highIsGood ? value > base : value < base)

/** The roll that gives the best (or worst) value of an attribute: a negative base falls as the multiplier grows. */
export function extremeRoll(base: number, highIsGood: boolean, good: boolean): number {
  const wantsHigherValue = highIsGood === good
  const higherMultiplierRaises = base >= 0
  return wantsHigherValue === higherMultiplierRaises ? 1 : 0
}
