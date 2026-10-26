# TrashTrack Context Flow and Core Entities

This is the **system context flow diagram** and core entity view for the working TrashTrack prototype. It describes system actors and data exchanges; it is not a conceptual framework.

## Context Flow

```mermaid
flowchart LR
  Resident[Resident]
  Driver[Collection Driver]
  Cenro[CENRO Operations]
  Cicto[CICTO Super Administrator]
  Mayor[Office of the Mayor]

  App[TrashTrack Mobile and Web App]
  Auth[Firebase Authentication]
  Data[(Cloud Firestore)]
  Functions[Firebase Cloud Functions]
  Media[Firebase Storage and Cloudinary]
  AI[Waste Image Classifier]
  Notify[Push Notifications and Email Delivery]
  Maps[Maps and Device GPS]

  Resident -->|Register, consent, verification image, collection report| App
  Driver -->|Sign in, scan QR, follow route, tag pickup| App
  Cenro -->|Manage accounts, barangay schedules, fleet, reports| App
  Cicto -->|Manage roles, privileges, rewards, oversight| App
  Mayor -->|Coordinate and participate in group chats| App

  App <--> Auth
  App <--> Data
  App <--> Functions
  App <--> Media
  App <--> AI
  App <--> Notify
  App <--> Maps
  AI -->|Classification result| App
  Functions -->|Provisioning, QR sign-in, secure group membership| Auth
  Functions -->|Validated operational updates| Data
  Data -->|Schedules, routes, announcements, analytics| App
  Notify -->|Collection reminders and account email| Resident
  Notify -->|Route and shift alerts| Driver
```

## Core Entities

```mermaid
erDiagram
  USER ||--o{ REPORT : submits
  USER ||--o{ SCHEDULE : assigned_to
  USER ||--o{ REWARD_AWARD : earns
  USER ||--o{ REWARD_REDEMPTION : requests
  USER ||--o{ INTERAGENCY_CHANNEL : joins
  USER ||--o{ INTERAGENCY_MESSAGE : sends
  BARANGAY ||--o{ BARANGAY_SCHEDULE : has
  BARANGAY ||--o{ COORDINATOR : served_by
  BARANGAY_SCHEDULE ||--o{ SCHEDULE : dispatches
  TRUCK ||--o{ SCHEDULE : serves
  TRUCK ||--o{ TRUCK_USAGE_HISTORY : records
  TRUCK ||--o{ FLEET_TRIP : records
  INTERAGENCY_CHANNEL ||--o{ INTERAGENCY_MESSAGE : contains
  REPORT ||--o| SCHEDULE : may_create_pickup

  USER {
    string uid
    string email
    string role
    string barangay
    string status
    string privileges
  }
  BARANGAY {
    string name
    string zone
  }
  COORDINATOR {
    string uid
    string employeeId
    string assignedBarangay
  }
  BARANGAY_SCHEDULE {
    string id
    string barangayName
    string collectionDays
    string collectionTime
  }
  SCHEDULE {
    string id
    string assignedDriverId
    string truckId
    string barangay
    string status
    datetime collectionDate
  }
  TRUCK {
    string id
    string plateNumber
    string status
    string assignedDriverId
  }
  TRUCK_USAGE_HISTORY {
    string id
    string truckId
    number collectedWeight
    datetime recordedAt
  }
  FLEET_TRIP {
    string id
    string truckId
    string driverId
    datetime startedAt
  }
  REPORT {
    string id
    string userId
    string status
    string imageUrl
    string barangay
  }
  REWARD_AWARD {
    string id
    string userId
    number tokens
    string reason
  }
  REWARD_REDEMPTION {
    string id
    string userId
    string status
  }
  INTERAGENCY_CHANNEL {
    string id
    string name
    string createdByUid
    string memberUids
  }
  INTERAGENCY_MESSAGE {
    string id
    string channelId
    string senderUid
    string message
    datetime createdAt
  }
```

The diagrams summarize the main flows and collections used by the prototype. Optional fields and supporting collections are omitted for readability.
