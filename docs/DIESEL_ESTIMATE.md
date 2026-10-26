# Diesel Estimate

## Access and setup

- CENRO: **Fleet & Personnel → Diesel Estimate**.
- Coordinator: **Field Operations → Trip & Diesel Log**, scoped to the assigned barangay.
- Driver: **Trip Log** on the home screen or **Trip & Diesel Log** in the profile. Ending a shift opens the log.

Use one record per master collection route from manual or automatic dispatch. Individual citizen pickups are not separate fuel trips. Enter each trip after the shift; never repeat one shift-wide fuel measurement across multiple trips.

CENRO sets its own PHP/L supply price, effective date and batch/source reference under **Supply price & parameters**. No commercial price API is used. The initial price is unset.

Physical defaults are demonstration assumptions: 3 km/L driving efficiency, 1 L/hour idle, 2 L/hour collection/compactor operation, 20% extra driving fuel at full load, 50% average load, and 3 collection minutes per stop. These are not CENRO measurements or manufacturer specifications. CENRO can edit fleet defaults or save a profile for the selected truck. Supply price remains fleet-wide. Truck profiles override later physical fleet-default changes.

With a configured price, dispatch saves original inputs, assumptions, price, model reference and results. Later price changes and route insertions do not rewrite that estimate. A trip without a dispatch-time estimate can receive a separately saved CENRO estimate; one made after a trip is retrospective.

Barangay routes remain demonstrations. Their distances are straight-line sums between waypoints, not verified road-driving distances. Default driving speed is 20 km/hour. GPS distance is kept separate.

## Transparent calculations

Driving liters = distance km / driving km per liter × (1 + full-load penalty / 100 × average load / 100).

Idle liters = idle hours × idle liters per hour.

Collection liters = collection hours × collection/compactor liters per hour.

Estimated liters = (driving + idle + collection liters) × applicable learned correction.

Projected cost = estimated liters × saved CENRO PHP/L price.

Operating hours = driving + idle + collection hours. These activities are mutually exclusive; driving fuel is already included through distance and must not be counted again as hourly fuel.

Projected savings = usual route estimate − optimized route estimate. Both use identical physical assumptions. Negative savings are retained. Actual variance = reported liters − saved estimated liters. Missing actual liters remain unknown.

Average load is the average percentage of truck capacity during driving, not simply final collected weight. Actual collected kilograms are stored separately.

## Entry, GPS and review

Record date, distance, driving/idle/collection hours, average load, collected kilograms, optional measured fuel consumption, measurement method and evidence. Import real GPS distance, enter an odometer difference, or mark distance manual/demo.

The existing foreground driver tracker records immutable real GPS points per trip when there is one unambiguous active route. Simulator points are excluded. Import rejects accuracy over 50 m, implied speed above 100 km/hour, and segments with gaps over five minutes. Gaps are shown; missing sections can undercount distance. This feature does not add background tracking. Multiple simultaneous routes require per-trip odometer measurements.

Ending a shift closes its master trips using the dieselClosedAt field. Later shifts receive distinct route records. This does not falsely mark unfinished citizen pickups as collected.

Fuel methods: tank balance (starting + added − ending liters), full-to-full refill covering only this trip, consumption meter, or not recorded. Fuel issued alone is not consumption. GPS cannot supply a measured fuel target. If a measurement covers multiple trips, leave individual fuel readings blank until independently measured.

New forms default to **DEMO**, excluded from real training. Device drafts are scoped to the user and trip. Submitting saves a draft first, so submission failure leaves a recoverable copy. Drafts are not automatically uploaded.

CENRO approves a pending submission or returns it for correction with a review note. One document per trip prevents driver/coordinator duplicates. Approved readings are locked.

## Learning

This is an interpretable regression calibration of estimated diesel liters. The waste-volume LSTM is unchanged. CENRO approval refreshes the truck model; **Update truck learning** retries it.

Eligibility: approved non-demo records from the same truck; positive measured consumption with evidence; GPS or odometer distance. Manual-distance records, missing fuel readings and unreviewed records are excluded.

At least 12 eligible trips are needed. A chronological split near 75% keeps the entire cutoff date in validation, with at least 8 earlier training trips and 3 later validation trips. The correction is fitted by least squares through the origin and bounded to 0.5–2.0. It is used only if validation MAE improves by more than 5% over the basic formula. Held-out records are not then reused to refit the selected factor.

Saved model metadata includes sample counts, training/validation counts, MAE, record IDs and a physical-parameter signature. Changed physical rates invalidate the old correction; a price change does not affect liters. Historical estimates remain unchanged.

No real model accuracy or municipal fuel savings can be claimed without verified operational data.

## Reports and rollout

Filter by truck, driver, barangay, trip identifier or trip month. Export CSV or **Print / Save PDF** from the web portal. Native devices share CSV text; printing/PDF is web-only. Reports distinguish demo, pending, approved and missing readings. Actual cost uses the saved estimate's supply price.

Storage: diesel_settings/main; schedules/{id}.routeOptimization.dieselEstimate; diesel_estimates/{scheduleId}; diesel_logs/{scheduleId}; diesel_gps/{scheduleId}/points/{id}; diesel_models/{truckId}.

Deploy updated Firestore rules with the application before live use. Local tests do not deploy or modify live data. Unrelated legacy collection rules are not redesigned by this feature.

Verification:

- npm run test:diesel — arithmetic, signed savings, original prices, learning validation, simulator exclusion, GPS quality and CSV escaping.
- Run functions/test/diesel.rules.test.js under the local Firestore emulator using firebase.test.json and project diesel-rules-test — role boundaries, validation, duplicate prevention, immutable records and application transactions.
- TypeScript check and production Expo web export.
