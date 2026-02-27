# InkScore Phase 1 - Dashboard Mockup

## Dashboard Layout

### Before Implementation (5 columns)
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          INKSCORE DASHBOARD                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐                  │
│  │ 💰       │ ⚡       │ 📈       │ 🏆       │ ⏰       │                  │
│  │ Net Worth│Total Txns│ Volume   │NFTs Held │On-Chain  │                  │
│  │ $12,345  │   150    │ $50,000  │    5     │ Age      │                  │
│  │          │          │ 25.5 ETH │          │ 45 Days  │                  │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### After Implementation (6 columns)
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          INKSCORE DASHBOARD                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────┬────────┬────────┬────────┬────────┬────────────┐               │
│  │ 💰     │ ⚡     │ 📈     │ 🏆     │ ⏰     │ 🏅         │               │
│  │ Net    │Total   │ Volume │NFTs    │On-Chain│InkScore    │               │
│  │ Worth  │ Txns   │        │Held    │ Age    │Phase 1     │               │
│  │$12,345 │  150   │$50,000 │   5    │45 Days │✓ Eligible  │               │
│  │        │        │25.5 ETH│        │        │Score: 7,060│               │
│  └────────┴────────┴────────┴────────┴────────┴────────────┘               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Phase 1 Card States

### State 1: Eligible Wallet (Green)
```
┌──────────────────────┐
│ 🏅                   │
│ InkScore Phase 1     │
│                      │
│ ✓ Eligible          │
│ Score: 7,060        │
│                      │
│ [Green Background]   │
└──────────────────────┘
```

### State 2: Not Eligible (Orange)
```
┌──────────────────────┐
│ 🏅                   │
│ InkScore Phase 1     │
│                      │
│ ✗ Not Eligible      │
│                      │
│                      │
│ [Orange Background]  │
└──────────────────────┘
```

### State 3: Loading
```
┌──────────────────────┐
│ 🏅                   │
│ InkScore Phase 1     │
│                      │
│ Loading...          │
│                      │
│                      │
│ [Gray Background]    │
└──────────────────────┘
```

## Detailed Card Design

### Eligible Wallet Card
```
╔══════════════════════════════════════╗
║  🏅  InkScore Phase 1                ║
║                                      ║
║  ┌────────────────────────────────┐ ║
║  │                                 │ ║
║  │    ✓ Eligible                  │ ║
║  │                                 │ ║
║  │    Score: 7,060                │ ║
║  │                                 │ ║
║  └────────────────────────────────┘ ║
║                                      ║
║  Background: bg-green-500/10         ║
║  Border: border-green-500/30         ║
║  Text: text-green-400                ║
╚══════════════════════════════════════╝
```

### Not Eligible Card
```
╔══════════════════════════════════════╗
║  🏅  InkScore Phase 1                ║
║                                      ║
║  ┌────────────────────────────────┐ ║
║  │                                 │ ║
║  │    ✗ Not Eligible              │ ║
║  │                                 │ ║
║  │                                 │ ║
║  │                                 │ ║
║  └────────────────────────────────┘ ║
║                                      ║
║  Background: bg-orange-500/10        ║
║  Border: border-orange-500/30        ║
║  Text: text-orange-400               ║
╚══════════════════════════════════════╝
```

## Responsive Behavior

### Desktop (6 columns)
```
┌────────┬────────┬────────┬────────┬────────┬────────┐
│ Card 1 │ Card 2 │ Card 3 │ Card 4 │ Card 5 │ Card 6 │
└────────┴────────┴────────┴────────┴────────┴────────┘
```

### Tablet (2 columns)
```
┌────────┬────────┐
│ Card 1 │ Card 2 │
├────────┼────────┤
│ Card 3 │ Card 4 │
├────────┼────────┤
│ Card 5 │ Card 6 │
└────────┴────────┘
```

### Mobile (1 column)
```
┌────────┐
│ Card 1 │
├────────┤
│ Card 2 │
├────────┤
│ Card 3 │
├────────┤
│ Card 4 │
├────────┤
│ Card 5 │
├────────┤
│ Card 6 │
└────────┘
```

## Color Scheme

### Eligible (Green Theme)
- Background: `bg-green-500/10`
- Border: `border-green-500/30`
- Icon: `text-green-400`
- Text: `text-green-400`
- Hover: `hover:bg-green-500/20`

### Not Eligible (Orange Theme)
- Background: `bg-orange-500/10`
- Border: `border-orange-500/30`
- Icon: `text-orange-400`
- Text: `text-orange-400`
- Hover: `hover:bg-orange-500/20`

### Loading State
- Background: `bg-slate-700/50`
- Animation: `animate-pulse`

## Animation

### Card Entry Animation
```css
@keyframes fade-in-up {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Phase 1 card has delay of 0.45s */
animation: fade-in-up 0.6s ease-out 0.45s both;
```

### Hover Effect
```css
.phase1-card:hover {
  transform: scale(1.02);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
  transition: all 0.3s ease;
}
```

## User Experience Flow

```
1. User connects wallet
   │
   ├─ Dashboard loads
   │  └─ Shows "Loading..." in Phase 1 card
   │
2. API fetches wallet stats
   │
   ├─ Phase 1 service checks eligibility
   │  └─ Returns status + score
   │
3. Dashboard updates
   │
   ├─ If eligible:
   │  └─ Show green card with ✓ and score
   │
   └─ If not eligible:
      └─ Show orange card with ✗
```

## Tooltip (Future Enhancement)

### Hover Tooltip for Eligible Wallets
```
┌──────────────────────────────────────┐
│ Phase 1 Eligibility                  │
├──────────────────────────────────────┤
│ Your wallet is eligible for Phase 1! │
│                                      │
│ Score: 7,060                         │
│ Rank: Top 1%                         │
│                                      │
│ Benefits:                            │
│ • Early access to features           │
│ • Exclusive rewards                  │
│ • Priority support                   │
└──────────────────────────────────────┘
```

### Hover Tooltip for Non-Eligible Wallets
```
┌──────────────────────────────────────┐
│ Phase 1 Eligibility                  │
├──────────────────────────────────────┤
│ Your wallet is not in Phase 1.       │
│                                      │
│ Don't worry! You can still:          │
│ • Participate in Phase 2             │
│ • Earn points for future phases      │
│ • Build your InkScore                │
└──────────────────────────────────────┘
```

## Accessibility

### ARIA Labels
```html
<div 
  role="status" 
  aria-label="InkScore Phase 1 Eligibility"
  aria-live="polite"
>
  <span aria-label="Eligible for Phase 1">✓ Eligible</span>
  <span aria-label="Score: 7,060">Score: 7,060</span>
</div>
```

### Keyboard Navigation
- Tab to focus on card
- Enter/Space to view details (future)
- Escape to close tooltip (future)

## Print Styles

When printing the dashboard:
```css
@media print {
  .phase1-card {
    break-inside: avoid;
    border: 1px solid #000;
    padding: 10px;
  }
  
  .phase1-card .icon {
    display: none; /* Hide decorative icons */
  }
}
```

## Dark Mode Support

Already implemented with Tailwind's dark mode classes:
- Uses `slate` color palette for backgrounds
- Maintains contrast ratios for accessibility
- Green/Orange colors work well in dark theme
