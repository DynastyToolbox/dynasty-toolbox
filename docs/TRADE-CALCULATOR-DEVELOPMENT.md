# League-connected trade calculator — development only

The membership development branch now calculates trades through the account API. This has
not been published to the live site. The local review page is
`http://localhost:8773/trade_calculator.html`, backed by the isolated development account project.

## Behavior

- Anonymous/free access supports two teams and manual player/pick search. Server requests
  for league imports or more than two teams require a current premium entitlement.
- Premium (including complimentary) access supports up to 12 calculator teams. Sleeper
  dynasty import supplies current rosters and three undrafted seasons of owned picks.
- Each roster can be selected once. Transfers validate original ownership, distinct asset
  identity, selected destinations and duplicates on the server. Original pick ownership is
  retained independently from current ownership and a former trade partner.
- All league rosters participate in before/after ranks. Contending/rebuilding scores average
  the best 15 player/pick values after applying the existing shared scoring adjustments.
  Ties use roster ID. Unranked assets are visible and contribute zero.
- Team trade values keep independent Overall/Contending/Rebuilding choices and the existing
  replacement-based stud bonus. The bonus affects trade sends, never roster ranks.
- Saved leagues use the existing account picker/default team. No second local league history
  is written. Loading/refreshing a league clears transfers; changing/removing a team clears
  only transfers involving that calculator team. Leaving league mode clears the trade.
- League data is cached for one minute in each warm server instance (maximum 20 leagues);
  membership access is checked again for every operation. Explicit refresh reloads ownership.
- Responses use private/no-store account headers. Only provider-verified identity and
  database membership records decide access; request-supplied premium flags are ignored.

## Verification

- 58 account, configuration, saved league, membership, database, scoring, median and trade tests
  passed, with no skipped tests. The separate Sleeper regression script passed 17 checks.
- Manual two-team browser search/transfers and the Superflex adjustment worked.
- Real development complimentary access enabled league imports and extra teams. The supplied
  10-team league loaded with current player inventories and 150 total owned picks.
- A browser three-way trade moved Drake Maye, Jayden Daniels, Rashee Rice and an originally
  different team's first-round pick; server results updated the receiving/sending rosters.
- Desktop layout at 1440 pixels had three centered 444-pixel cards and no horizontal overflow.
  Phone layout at 375 pixels had one card per row and no overflowing controls.
- Saved-link loading waits for both account leagues and calculator membership configuration,
  preventing a disabled Load button from dropping the initial automatic import.

## Market balance review — September 21, 2026

- Server evaluation now returns each team's Overall sends, receives and net, applying the
  shared league scoring filters and excluding stud bonus. Existing team totals and ranks
  retain their independent scoring modes and calculations.
- A lightweight SVG display sits above the team cards: two-team balance bar, or 3–12 team
  radar polygon. Numbered axes map to full team names and signed values in an adjacent list.
  The radar's halfway ring is zero; outward means gain, inward loss. Shared symmetric scale
  starts at ±5,000 and expands in 5,000-point steps. Unranked transfers display an incomplete
  balance warning. Pending/error states remove stale results.
- Eight trade tests pass, including Overall independence from team modes/bonus, league
  scoring changes, three-way conservation, unranked values, scale expansion and 12 axes.
- Browser checks: two-team Josh Allen transfer expanded to ±15,000; a three-way Allen /
  Jefferson / Bowers exchange returned -3,351 / +3,033 / +318 despite mixed ranking modes.
  TE Premium changed Bowers' market contribution. Clear restored zero and ±5,000. Twelve
  slots fit a 375px viewport without horizontal overflow; desktop checked at 1440px.
- This addition remains local to the development branch, not production or hosted preview.

## Remaining launch work

This checkpoint is for review. The protected HTTPS preview still needs this commit uploaded
and a hosted calculator smoke test. No real billing or new public access limits are enabled.
The existing public Git history/rankings are not made secret by this change; protect the other
premium page data/operations and implement simulator limits before membership launch.

Sleeper's current API documentation explicitly requests that commercial users contact Sleeper
to discuss licensing: https://docs.sleeper.com/ . Resolve commercial permission before a paid launch.
