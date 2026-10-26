# Major Feature Status

Last reviewed: 2026-08-13

## Implemented and demonstrable

- Driver authentication verifies an active Firebase profile with the `driver` role, and the driver route group blocks unauthenticated, disabled, and non-driver accounts.
- Resident reporting, dispatch, completion measurements, schedules, announcements, notifications, feedback, truck inventory, route assignment, dashboards, and Firebase synchronization are implemented.
- Waste values use metric tons internally. The interface displays kilograms below 1,000 kg and automatically switches to metric tons at or above 1,000 kg.
- Historical waste forecasting uses the cleaned Danao City Block A monthly volume series and compares statistical baselines using MAE, RMSE, and MAPE.
- Route dispatch uses the Google Routes API for road polylines, traffic-aware distance, and driving duration when configured, with an automatic local fallback.
- The route constraint engine enforces the assigned truck's numeric capacity and orders accepted stops using priority, service windows, report age, distance, and optional traffic-aware routing. Stops over capacity are visibly deferred to another trip.
- GPS report-density heat maps are visible on the CENRO web dashboard and native map view.
- The CICTO web portal now has working overview, data-management, identity/access, fleet-operations, rewards, and CENRO-command sections. Desktop role routing sends CICTO accounts to the CICTO portal instead of the CENRO portal.
- CICTO overview, data inventory, permitted role management, inter-agency commands, fleet operations, and rewards now run directly through Firestore on the Spark plan. CENRO has a real-time CICTO command inbox; no paid Functions deployment is required for these active paths.
- On the Firebase Spark plan, verified citizen-report collections create one deterministic 100-token Firestore ledger award per report. CICTO calculates balances from awards minus redemptions and can reconcile eligible historical completions without duplicating awards. The stricter Cloud Functions transaction path remains prepared for a future Blaze upgrade but is not deployed.
- Residents now see their real award-minus-redemption balance, measured collection impact, approved souvenir catalog, and immutable activity history. Souvenirs use staff-verified physical issuance; there is no online payment dependency.
- Driver onboarding and account role changes use Spark-compatible Firebase Auth and Firestore. New accounts are created with an isolated secondary Auth session so the current CENRO administrator remains signed in, while employee IDs and license numbers are reserved transactionally.
- Environmental coordinator onboarding now uses the same Spark-compatible secondary Auth pattern, reserves employee IDs transactionally, and sends Firebase email-verification links without signing out the current administrator.
- Operational Overrides now maps actual driver GPS locations and unresolved geotagged reports, calculates barangay hotspots from live records, and exports the real override activity log. Static simulated typhoon, road-closure, and hotspot claims were removed.
- Resident, driver, admin, and CICTO password flows now use Firebase email verification, real password-reset email, and twelve-character password requirements. Password changes use Firebase credential reauthentication; pending and remembered login state never stores a password.
- Firestore rules validate role and ownership boundaries, verified resident profiles, employee-ID reservations, and exact reward redemption catalog prices. Reward ledger records are immutable after creation. The rules passed the local emulator suite and were released to `trashtrack-swu-98ce9` on 2026-08-13.
- Google OAuth uses PKCE without a client secret, and Cloudinary uploads use an unsigned upload preset. Previously configured public secret-named variables are no longer referenced by application code or embedded in the verified web bundle.
- The repository passes the project-wide strict TypeScript check and Expo lint. The production web export completes with all forty-eight application routes, and barangay schedule creation persists selected collection days.

## Implemented but awaiting operational data or deployment

- A TensorFlow inference HTTP service loads the saved Keras model and scaler, exposes health/model endpoints, and returns one- to twelve-month forecasts. The CENRO analytics page can call it when `EXPO_PUBLIC_FORECAST_API_URL` points to a deployed service.
- Monthly model monitoring compares forecast values with `ml/data/production_actuals.csv`, triggers five-seed retraining when at least three matched periods exceed the 15% MAPE gate, and records a model-registry report. The automation currently waits for real actuals.
- Actual expense entry and budget validation are available in CENRO analytics. The engine calculates weighted cost per ton, rolling backtest MAE/MAPE, contingency, and forecast-period cost; it needs at least three approved expense periods before it can report a backtested result.
- Fleet telemetry now records trip trails, speed, route deviation, and schedule context. CENRO and CICTO can replay trips and review overspeed or off-route alerts. Real background-device testing is still required before calling it production-grade tracking.

## Limited or not yet officially validated

- The current TensorFlow LSTM remains a candidate. Its five-seed ensemble beat seasonal-naive MAE by 5.53%, but only two of five individual seeds won, so it has not passed the stability gate for automatic promotion.
- Road-aware routing requires a Google Maps Platform key with Routes API access and may incur usage charges. The local fallback keeps the constraint-selected order but cannot model live traffic.
- Budget validation is not an official prediction until actual CENRO expense records are entered, reviewed, and backtested.
- Fleet alerts use foreground Expo location updates; background behavior, battery use, poor-connectivity recovery, and alert thresholds still need field validation.
- The historical workbook still requires formal reconciliation of its unnamed blocks, mixed units, 2023 detail-versus-total differences, and 2025 anomalies.
- Capstone security hardening is implemented for client credential handling, verified-email gates, password reset/change, Firestore authorization, immutable rewards, and Spark onboarding. A public municipal launch should still add App Check, restricted API keys and quotas, trusted server-side staff provisioning, monitoring, and a formal security review.

## Defense wording

Describe routing as **constraint-aware dispatch with Google road routing and an automatic local fallback**. Describe forecasting as **a validated statistical baseline plus a deployable TensorFlow candidate service with automated monitoring**. Describe budget output as **actual-record-based validation that remains pending until three approved periods are available**. Describe fleet monitoring as **trip telemetry, replay, and operational alerts undergoing field validation**. Do not claim that the LSTM is promoted, that budget output is officially validated without real expense records, or that fleet tracking has completed production field trials.
