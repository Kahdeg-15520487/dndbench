# 09 — Arena & Movement

How the battlefield, positioning, and distance work.

---

## Arena Configuration

The battlefield is a 2D rectangle measured in **feet**.

### Arena Presets

| Preset  | Width | Height | Label              | Usage                |
|---------|-------|--------|--------------------|----------------------|
| small   | 60ft  | 40ft   | Small Arena        | —                    |
| medium  | 100ft | 60ft   | Arena (default)    | 1v1, 2v2            |
| large   | 140ft | 80ft   | Large Arena        | 3v3, 4v4            |
| boss_room | 120ft | 80ft | Boss Room          | Raid boss encounters |
| grand   | 180ft | 100ft  | Grand Colosseum    | 5+ participants      |

### Auto-Selection

```
participants ≤ 2  → medium (100×60)
participants ≤ 4  → large  (140×80)
participants > 4  → grand  (180×100)
```

---

## Position System

Each character has a `(x, y)` position in feet.  The origin `(0, 0)` is the
top-left corner.

### Coordinate System

```
(0,0)─────────────────────────(width,0)
  │                               │
  │    (50,30) • Alpha            │
  │              ↕ 40ft distance  │
  │    (50,70) • Beta             │
  │                               │
(0,height)────────────────(width,height)
```

### Distance Calculation

Euclidean distance between two points:

```
distance = √((x₂−x₁)² + (y₂−y₁)²)
```

This returns distance in feet.  Melee range is **5ft** (one square in grid
terms).

---

## Starting Positions

### 1v1 (Two Characters)

Classic left/right placement:

```
Alpha at (10, arenaHeight/2)
Beta  at (width−10, arenaHeight/2)
```

Starting distance: `width − 20` feet (80ft on medium arena).

### Team-Based (2+ Teams)

Characters on the same team cluster on one side:

```
Team A → left side (x = 10)
Team B → right side (x = width − 10)
Team C → spread across width
```

Team members are vertically spaced to avoid overlap.

### Free-For-All (All Unique Teams)

Circular layout:

```
Each participant placed evenly around a circle
Center = (width/2, height/2)
Radius = min(width, height) × 0.35
```

---

## Movement Resolution

### Per-Turn Movement

Each turn, a character can move up to their speed:

```
maxMovement = speed + (hasCunningAction ? 15 : 0)
```

### Movement Vector

Agents specify movement as `{ dx, dy }` (delta from current position).

The vector is **truncated** if its magnitude exceeds max movement:

```
if (magnitude > maxMovement) {
  scale = maxMovement / magnitude
  dx = round(dx × scale)
  dy = round(dy × scale)
}
```

Position is clamped to arena bounds `[0, width] × [0, height]`.

### Movement Timing

Movement happens **before** the action:

1. Agent returns action with optional `move: { dx, dy }`
2. `resolveMove()` calculates new position
3. `resolveAction()` uses the **new position** for range checks

> **5e Accuracy:** ✅ Movement can be split before and after an action in 5e
> ("you can break up your movement on your turn").  The engine only allows
> movement before the action (simplified).

---

## Range System

### Melee Range

All melee attacks require distance ≤ **5ft** (one square).

Some boss weapons have extended reach (10ft) via the `reach` property.

### Spell Range

Each spell has a range in feet:

| Spell           | Range   |
|-----------------|---------|
| Fire Bolt       | 120ft   |
| Magic Missile   | 120ft   |
| Thunderwave     | 15ft    |
| Scorching Ray   | 120ft   |
| Hold Person     | 60ft    |
| Fireball        | 150ft   |
| Lightning Bolt  | 100ft   |
| Cure Wounds     | 5ft (touch) |
| Shield          | 0ft (self)   |
| Shield of Faith | 0ft (self)   |

### Out-of-Range Behavior

If the target is beyond the action's range:

| Action Type  | Behavior                              |
|--------------|----------------------------------------|
| Attack       | "Too far away!" — action wasted        |
| Spell        | "Too far away!" — action AND slot wasted |
| Bomb         | "Too far away!" — item **refunded**    |

> **5e Accuracy:** ⚠️ In 5e, you know if a target is in range before casting.
> Wasting a slot on an out-of-range spell is not how 5e works — the caster
> would know the target is too far and choose a different action.

---

## Dash Action

Double movement speed toward a target:

```
dashSpeed = speed × 2
direction = normalize(target.position − actor.position)
moveDistance = min(dashSpeed, distanceToTarget)
newPosition = actor.position + direction × moveDistance
```

Costs the **full action** — no attack possible after dashing.

✅ Accurate to 5e RAW.

---

## Heuristic Agent Movement

The heuristic AI attaches movement to actions when out of range:

```typescript
const withMove = (action, requiredRange) => {
  if (distance > requiredRange) {
    action.move = moveToward(myPos, targetPos, speed);
  }
  return action;
};
```

It also uses Dash when the target is beyond `speed + MELEE_RANGE` distance
(can't close with a normal move).
