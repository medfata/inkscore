# NFT Staking Card UI Update

## Summary
Updated the NFT Staking card to display collection logos in an overlapping style, similar to the NFT Trading card, replacing the single lock emoji icon.

## Changes Made

### Dashboard Component (`app/components/Dashboard.tsx`)

#### 1. Added NFT Staking Collections Mapping
```tsx
const NFT_STAKING_COLLECTIONS: Record<string, { name: string; logo: string; url: string }> = {
  'Shellies Staked': {
    name: 'Shellies',
    logo: 'https://pbs.twimg.com/profile_images/1948768160733175808/aNFNH1IH_400x400.jpg',
    url: 'https://twitter.com/ShelliesNFT',
  },
  'INK Bunnies Staked': {
    name: 'INK Bunnies',
    logo: 'https://pbs.twimg.com/profile_images/2017562853859815425/OmYpLZrN_400x400.jpg',
    url: 'https://twitter.com/InkBunnies',
  },
  'Boink Staked': {
    name: 'Boink',
    logo: 'https://pbs.twimg.com/profile_images/1972236253119623168/DqTXu2J5_400x400.png',
    url: 'https://twitter.com/Boi_Ink',
  }
};
```

#### 2. Updated Card Header (Overlapping Logos)
```tsx
<h3 className="text-lg font-semibold text-white flex items-center gap-2">
  <span className="text-2xl">🔒</span>
  NFT Staking
</h3>
```

#### After
```tsx
<h3 className="text-lg font-semibold text-white flex items-center gap-2">
  <div className="flex items-center -space-x-3">
    <a href="https://twitter.com/ShelliesNFT" target="_blank" rel="noopener noreferrer"
       className="hover:z-10 hover:ring-2 hover:ring-amber-500/50 rounded-full transition-all cursor-pointer"
       style={{ zIndex: 3 }} title="Shellies">
      <img src="https://pbs.twimg.com/profile_images/1948768160733175808/aNFNH1IH_400x400.jpg"
           alt="Shellies" className="w-6 h-6 rounded-full object-cover bg-slate-800" />
    </a>
    <a href="https://twitter.com/InkBunnies" target="_blank" rel="noopener noreferrer"
       className="hover:z-10 hover:ring-2 hover:ring-amber-500/50 rounded-full transition-all cursor-pointer"
       style={{ zIndex: 2 }} title="INK Bunnies">
      <img src="https://pbs.twimg.com/profile_images/2017562853859815425/OmYpLZrN_400x400.jpg"
           alt="INK Bunnies" className="w-6 h-6 rounded-full object-cover bg-slate-800" />
    </a>
    <a href="https://twitter.com/Boi_Ink" target="_blank" rel="noopener noreferrer"
       className="hover:z-10 hover:ring-2 hover:ring-amber-500/50 rounded-full transition-all cursor-pointer"
       style={{ zIndex: 1 }} title="Boink">
      <img src="https://pbs.twimg.com/profile_images/1972236253119623168/DqTXu2J5_400x400.png"
           alt="Boink" className="w-6 h-6 rounded-full object-cover bg-slate-800" />
    </a>
  </div>
  NFT Staking
</h3>
```

## UI Features

### Overlapping Logo Design (Header)
- Three collection logos displayed in an overlapping style using `-space-x-3`
- Z-index stacking: Shellies (3), INK Bunnies (2), Boink (1)
- Creates a visual hierarchy showing all three collections at once

### Individual Logos in Breakdown (Body)
- Each collection in the "By Collection" section displays its own logo (3x3px)
- Logos appear next to the collection name
- Same interactive features as header logos
- Matches the design pattern used in the NFT Trading card

### Interactive Elements
- Each logo is clickable and links to the collection's Twitter profile
- Hover effects:
  - Logo moves to top layer (`hover:z-10`)
  - Amber ring appears around the logo (`hover:ring-2 hover:ring-amber-500/50`)
  - Smooth transitions for all hover states
- Tooltips show collection names on hover

### Collection Logos

1. **Shellies**
   - URL: `https://pbs.twimg.com/profile_images/1948768160733175808/aNFNH1IH_400x400.jpg`
   - Twitter: [@ShelliesNFT](https://twitter.com/ShelliesNFT)
   - Position: Front (z-index: 3)

2. **INK Bunnies**
   - URL: `https://pbs.twimg.com/profile_images/2017562853859815425/OmYpLZrN_400x400.jpg`
   - Twitter: [@InkBunnies](https://twitter.com/InkBunnies)
   - Position: Middle (z-index: 2)

3. **Boink**
   - URL: `https://pbs.twimg.com/profile_images/1972236253119623168/DqTXu2J5_400x400.png`
   - Twitter: [@Boi_Ink](https://twitter.com/Boi_Ink)
   - Position: Back (z-index: 1)

### Fallback Images
Each logo has a fallback using UI Avatars API if the Twitter image fails to load:
- Shellies: `https://ui-avatars.com/api/?name=S&background=f59e0b&color=fff&size=24`
- INK Bunnies: `https://ui-avatars.com/api/?name=IB&background=f59e0b&color=fff&size=24`
- Boink: `https://ui-avatars.com/api/?name=B&background=f59e0b&color=fff&size=24`

All fallbacks use amber background (`f59e0b`) to match the card's color scheme.

## Design Consistency

This update makes the NFT Staking card consistent with the NFT Trading card, which also uses overlapping logos to represent multiple platforms. The pattern is now:

- **NFT Trading Card**: Shows overlapping logos of NFT marketplaces (Net Protocol, Mintiq, Squid Market)
- **NFT Staking Card**: Shows overlapping logos of NFT staking collections (Shellies, INK Bunnies, Boink)

Both cards use the same visual language to indicate "multiple sources/collections" at a glance.

## Benefits

1. **Visual Clarity**: Users can immediately see which collections are tracked
2. **Brand Recognition**: Collection logos are more recognizable than a generic emoji
3. **Interactivity**: Users can click through to learn more about each collection
4. **Consistency**: Matches the design pattern used elsewhere in the dashboard
5. **Scalability**: Easy to add more collections by adding more logos to the stack

## Future Additions

To add a new collection logo:

1. Add a new `<a>` tag with the collection's logo and Twitter link
2. Adjust z-index values (new collection gets lowest z-index)
3. Update the `-space-x-3` if needed for more logos
4. Add appropriate fallback image

Example for a 4th collection:
```tsx
<a href="https://twitter.com/NewCollection" target="_blank" rel="noopener noreferrer"
   className="hover:z-10 hover:ring-2 hover:ring-amber-500/50 rounded-full transition-all cursor-pointer"
   style={{ zIndex: 0 }} title="New Collection">
  <img src="https://example.com/logo.jpg" alt="New Collection"
       className="w-6 h-6 rounded-full object-cover bg-slate-800" />
</a>
```


## Breakdown Section Update

### Individual Collection Logos

Each collection in the "By Collection" breakdown now displays its own logo next to the name:

```tsx
<div className="space-y-1">
  {!isDemo && nftStaking?.sub_aggregates?.map((item, idx) => {
    const collectionInfo = NFT_STAKING_COLLECTIONS[item.label];
    return (
      <div key={idx} className="flex justify-between items-center text-[11px]">
        <span className="text-slate-400 flex items-center gap-1">
          {collectionInfo && (
            <a href={collectionInfo.url} target="_blank" rel="noopener noreferrer"
               className="hover:ring-2 hover:ring-amber-500/50 rounded transition-all cursor-pointer"
               title={`Visit ${collectionInfo.name}`}>
              <img src={collectionInfo.logo} alt={collectionInfo.name}
                   className="w-3 h-3 rounded" />
            </a>
          )}
          {collectionInfo?.name || item.label}
        </span>
        <span className="font-mono text-white">{item.value}</span>
      </div>
    );
  })}
</div>
```

### Visual Result

The card now displays:

**Header:**
- [Shellies Logo] [INK Bunnies Logo] [Boink Logo] NFT Staking

**Breakdown:**
- [🐚] Shellies .................. 0
- [🐰] INK Bunnies ............... 0  
- [🎯] Boink ..................... 0

Each logo is:
- 3x3px in the breakdown section
- 6x6px in the header (overlapping)
- Clickable with hover effects
- Linked to the collection's Twitter

This matches the exact pattern used in the NFT Trading card where each platform (Squid Market, Net Protocol, Mintiq) has its logo displayed next to its name in the breakdown.
