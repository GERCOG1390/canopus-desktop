// Canopus' own notes on game mechanics for the assistant's knowledge base: the formulas Canopus itself
// computes with, written out so the model can explain them. Short, and kept in step with the engines.

export const NOTES: { title: string; text: string }[] = [
  {
    title: 'Stacking penalties (formula)',
    text: 'Several modules or rigs changing the same attribute are applied strongest first, each at an effectiveness of exp(-((n-1)/2.67)^2) for the n-th: 100%, 86.9%, 57.1%, 28.3%, 10.6%, 3.0%. Bonuses and penalties (drawbacks) are penalized separately. Skills, ship hull bonuses and most implants are not stacking-penalized. Damage Control modules are not penalized with other resistance modules. Example: two Stasis Webifier II (-60% each) on one target: 0.40 × (1 - 0.60 × 0.869) = 0.19, so the target keeps 19% of its speed.'
  },
  {
    title: 'Resistances and effective HP (EHP)',
    text: 'Damage taken on a layer = incoming damage × (1 - resistance) per damage type (EM, thermal, kinetic, explosive). Resistance modules combine multiplicatively on the damage taken: (1 - r1) × (1 - r2 × stacking) …, so 50% + 50% gives 75%, not 100%. EHP of a layer = HP / (share of damage that gets through); for uniform damage (25% of each type) that is HP / (0.25 × Σ(1 - r_i)). Total EHP = shield + armor + hull EHP. Against a single damage type EHP is HP / (1 - r) of that type.'
  },
  {
    title: 'Turret hit chance and damage (formula)',
    text: 'Chance to hit = 0.5 ^ ( (angular velocity × 40000 / (tracking × target signature))^2 + (max(0, distance - optimal) / falloff)^2 ). Angular velocity = transversal speed / distance (rad/s). At optimal + 1 falloff the range term alone gives 50%. Hits do 50% to 150% damage (average over hits is lower than 1 at low chance); 1% of shots are wrecking hits for 300%. Drones use the same formula with their own tracking and range, but fly to the target. Reduce transversal (approach directly) or use tracking computers/webs to hit small fast targets.'
  },
  {
    title: 'Missile damage application (formula)',
    text: 'Missiles always hit within flight range (missile velocity × flight time). Damage factor = min(1, S/E, (S × Ve / (E × Vt))^drf), where S = target signature radius, E = explosion radius, Ve = explosion velocity, Vt = target speed, drf = damage reduction factor of the missile. Bigger signature (target painters, MWD bloom) and slower targets (webs) take more damage. Rage/Javelin type ammo trades application or range for damage; Precision/Fury trade the other way. A target flying away from the missile shortens its effective range.'
  },
  {
    title: 'Capacitor recharge (formula)',
    text: 'Capacitor (and passive shield) recharge depends on how full it is: rate = 10 × C / τ × (√c - c), where C = capacity, τ = recharge time, c = current fraction (0..1). The peak is at 25%: 2.5 × C / τ. A fit is "cap stable" when the average use per second is below the curve; the stable level is where use equals the recharge: c = ((1 + √(1 - 4 × use × τ / (10 × C))) / 2)^2. The in-game fitting window shows the margin (peak recharge minus use, Δ GJ/s). Unstable fits run dry in the time Canopus simulates activation by activation. Capacitor boosters inject charges on their own cycle.'
  },
  {
    title: 'Passive shield regeneration',
    text: 'Shield HP regenerate on the same curve as the capacitor: rate = 10 × S / τ × (√s - s), peak 2.5 × S / τ at 25% shield, nothing at 100%. A "passive tank" works because the shield sits low under fire; shield power relays and purger rigs shorten τ, extenders raise S. Peak regen is the number usually quoted (HP/s).'
  },
  {
    title: 'Align time and warp',
    text: 'A ship enters warp after reaching 75% of its top speed in the warp direction. Align time = -ln(0.25) × mass × inertia modifier / 1 000 000 ≈ 1.386 × mass(kg) × inertia / 10^6 seconds. The server acts on whole-second ticks, so the real time is rounded up to the next second. Lower mass (no plates) and better inertia (nanofibers, Inertial Stabilizers, skills Evasive Maneuvering, Spaceship Command) align faster. A MWD adds mass and makes aligning slower unless it is cycled to burst before warp.'
  },
  {
    title: 'Propulsion modules: afterburner, microwarpdrive',
    text: 'Speed boost = speed factor % × thrust / ship mass. Both modules add mass to the ship. A microwarpdrive (MWD) gives a much larger boost but blooms the signature radius by about 500% (smaller on some hulls), uses more capacitor and cannot run while the ship is warp scrambled. An afterburner (AB) does not bloom signature and keeps working under a scrambler. Acceleration Control raises the boost; Fuel Conservation lowers the capacitor use.'
  },
  {
    title: 'Targeting: lock time',
    text: 'Time to lock a target = 40000 / (scan resolution × asinh(target signature radius)^2) seconds. Higher scan resolution (sensor boosters, skills) and bigger target signature (MWD bloom, painters) lock faster. Maximum targeting range and the number of targets come from the ship and skills (Target Management, Advanced Target Management). Sensor dampeners lower range and scan resolution; ECM breaks locks depending on jammer strength vs sensor strength.'
  },
  {
    title: 'Stasis webifiers and target painters',
    text: 'A stasis webifier lowers the target\'s maximum velocity (Stasis Webifier II: -60% within 10 km, no falloff). Stasis grapplers are stronger but reach about 1 km with falloff. A target painter raises the target\'s signature radius (Target Painter II: +30% before skills, long range with falloff). Beyond optimal range the effect drops as 0.5^((distance - optimal) / falloff)^2. Several webs or painters on one target are stacking-penalized.'
  },
  {
    title: 'Warp disruptors and scramblers',
    text: 'A ship cannot warp while the warp disruption strength on it is at least its warp core stability (usually 0, raised by Warp Core Stabilizers). Warp Disruptor II: 1 point at about 24 km. Warp Scrambler II: 2 points at about 9 km, and it also shuts down microwarpdrives and micro jump drives (not afterburners). Warp disruption fields (bubbles) from interdictors and heavy interdictors stop warping ships in null-sec and wormholes; interdiction-nullified ships pass through bubbles.'
  },
  {
    title: 'Drones: limits and control',
    text: 'Up to 5 drones can be in space (Drones skill), and their bandwidth may not exceed the ship\'s drone bandwidth; some hulls (Gila, Rattlesnake…) launch only two bigger drones with large bonuses. Drone control range is 20 km plus Drone Avionics (+5 km per level) and Advanced Drone Avionics (+3 km per level). Drones apply damage with the turret formula after they reach the target; a target faster than the drones outruns them. Drone Damage Amplifiers are stacking-penalized.'
  }
]
