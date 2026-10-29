# Modern Angular for AI-ready frontends

## Change detection
- Default: checks the tree after zone-tracked async events.
- OnPush: skips unless inputs change by reference, internal events, async pipe emissions, or explicit marking.
- Signals: templates reading signals refresh when they change; enables zoneless apps.

Rules: immutable input updates; `computed()` for derived state; `effect()` only for side effects; async pipe or `toSignal` instead of manual subscribe.

## RxJS flattening cheat sheet
| Operator | New value while inner is running | UI example |
|---|---|---|
| switchMap | cancel previous | search-as-you-type, regenerate answer |
| mergeMap | run in parallel | independent uploads |
| concatMap | queue in order | sequential saves |
| exhaustMap | ignore new | submit button |

Put `catchError` inside the inner pipe.

## DI
Root singletons for app-wide services; component-level providers for per-widget state (e.g., each copilot panel's session); route-level providers for feature scope.

## Large apps
Domain-based boundaries, lazy standalone routes, library types (feature/ui/data-access/util) with enforced dependency rules, typed API clients, design system, ADRs, strangler migrations.

## Data-dense performance
Profile first; virtualise rows; OnPush + trackBy; precompute formatting; batch or scope requests to visible rows (avoid N+1 lookups); keep a performance budget test.
