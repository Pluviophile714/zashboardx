# Mobile Latency Inspection Design

## Goal

Keep the mobile proxy-quality popover readable while users inspect the 24h chart and the R5S recent-30 latency strip by touch. Desktop hover behavior and the desktop sample list remain unchanged.

## Approved Interaction

- The compact 24h chart keeps its selected bucket information outside the SVG plot. The most recent bucket is shown initially, touch movement updates it, and the chart itself stays unobstructed.
- The compact recent-30 strip shows the existing `min / avg / max` summary by default.
- Touching or dragging across a populated recent-30 segment temporarily replaces that same summary row with `MM-DD HH:mm:ss`, latency, and success/failure.
- The selected segment receives a visible outline. Releasing or cancelling the pointer restores `min / avg / max` after 1000ms.
- Empty leading slots do not fabricate sample details.
- Touches inside either chart remain inside the existing mobile popover boundary; outside touch remains the only mobile close action.

## Layout

The compact 24h bucket readout is appended below the fixed-height SVG body. It retains average, range, success count, and failure count so moving it does not remove existing information.

The recent-30 detail uses the existing summary row below the bars. Reusing that row avoids increasing popover height or shifting surrounding content during interaction.

## Scope

Only compact/mobile rendering changes. Metrics collection, source resolution, timelines, sample ordering, availability calculations, manual latency tests, desktop tooltip placement, and the desktop detail list remain unchanged.

## Validation

- Pure tests cover compact tooltip mode and pointer-position to sample-index mapping.
- Existing helper tests, type-check, and production build must pass.
- Mobile preview verifies graph visibility, drag selection, delayed summary restoration, internal touch retention, and outside-touch close.
- Desktop preview verifies the existing overlay tooltip and full sample list are unchanged.
