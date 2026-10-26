# TrashTrack

**TrashTrack** is a smart waste collection information and tracking system developed as a Capstone project for **Danao City**. The system is designed to improve communication and coordination between residents, garbage truck drivers, and administrators involved in waste collection.

TrashTrack provides residents with access to **garbage collection schedules, announcements, and other waste-management information**. It also includes a dedicated driver portal for garbage collection personnel and supports location-based tracking for collection operations.

The project also integrates a **Retrieval-Augmented Generation (RAG) AI chatbot** that uses stored documents as a knowledge base and generates responses through the Groq API.

## Project Purpose

TrashTrack aims to make waste collection information easier to access and manage.

The system is intended for:

* **Residents** – view garbage collection schedules, announcements, and relevant information.
* **Garbage Truck Drivers** – access their dedicated portal and support collection tracking.
* **Administrators** – manage schedules, announcements, users, and system information.
* **CENRO personnel** – support and oversee waste collection operations.

## Main Features

* Garbage collection schedules
* Announcements and notifications
* Resident/user portal
* Garbage driver portal
* Administrator management
* Location/GPS-based collection tracking
* RAG AI chatbot
* Firebase Authentication
* Firestore database
* Firebase Cloud Functions
* Groq API integration
* Google and Facebook authentication support
* Android, iOS, and Web support through React Native and Expo

## Technology Stack

* **React Native**
* **Expo**
* **TypeScript / JavaScript**
* **Firebase Authentication**
* **Cloud Firestore**
* **Firebase Cloud Functions**
* **Groq API**
* **LLaMA-based AI model**
* **Expo Router**

## Setup Instructions

### 1. Prerequisites

Before running the project, install:

* Node.js 18 or later
* npm
* Firebase CLI
* Expo development tools
* Git

You will also need access to:

* A Firebase project
* A Groq API key

### 2. Clone the Repository

```bash
git clone https://github.com/WMROger/TrashTruck.git
cd TrashTruck
```

### 3. Install Project Dependencies

From the root directory:

```bash
npm install
```

Install the Firebase CLI if it is not already installed:

```bash
npm install -g firebase-tools
```

### 4. Configure Firebase

Log in to Firebase:

```bash
firebase login
```

Connect the local project to the appropriate Firebase project:

```bash
firebase use --add
```

The repository already contains:

```text
firebase.json
firestore.rules
firestore.indexes.json
```

Firebase application configuration is handled through:

```text
config/firebase.ts
```

### 5. Configure Environment Variables

Create a `.env` file in the root directory.

Add the Firebase configuration values for the project:

```env
EXPO_PUBLIC_FIREBASE_API_KEY=your_firebase_api_key
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
EXPO_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
EXPO_PUBLIC_FIREBASE_APP_ID=your_app_id
```

Get these values from:

**Firebase Console → Project Settings → General → Your Apps**

> **Important:** Never commit the `.env` file or private API keys to GitHub.

### 6. Configure the Groq API

Generate a Groq API key from the Groq Console.

Configure the key for Firebase Cloud Functions:

```bash
firebase functions:config:set groq.key="your_groq_api_key"
```

The Groq API key should remain on the backend and should not be exposed directly in the React Native application.

### 7. Install Cloud Function Dependencies

```bash
cd functions
npm install
cd ..
```

### 8. Deploy Firebase Functions

```bash
firebase deploy --only functions
```

If Firestore rules and indexes also need to be deployed:

```bash
firebase deploy --only firestore
```

### 9. Configure Authentication

In the Firebase Console:

1. Open **Authentication**.
2. Go to **Sign-in method**.
3. Enable **Email/Password**.
4. Configure **Google** or **Facebook** authentication if required.

Additional setup documentation can be found inside the `docs/` folder.

### 10. Run the Application

Start the Expo development server:

```bash
npm start
```

Run a specific platform with:

```bash
npm run android
npm run ios
npm run web
```

The project can also be opened through the Expo development environment after starting the server.

## File Structure

| Folder / File            | Purpose                                                                          |
| ------------------------ | -------------------------------------------------------------------------------- |
| `.vscode/`               | Visual Studio Code workspace and editor configuration.                           |
| `app/`                   | Main application screens, routes, layouts, authentication pages, and navigation. |
| `assets/`                | Static application resources such as images, icons, and other media.             |
| `components/`            | Reusable React Native UI components used throughout the application.             |
| `config/`                | Application configuration, including Firebase configuration.                     |
| `constants/`             | Shared constant values used by different parts of the application.               |
| `docs/`                  | Additional project, Firebase, authentication, and setup documentation.           |
| `functions/`             | Firebase Cloud Functions and backend logic, including AI/RAG functionality.      |
| `hooks/`                 | Reusable React hooks and application-specific hooks.                             |
| `scripts/`               | Utility and project setup scripts.                                               |
| `styles/`                | Shared styling and design-related files.                                         |
| `.gitignore`             | Defines files and folders that Git should not commit.                            |
| `app.json`               | Expo application configuration.                                                  |
| `eslint.config.js`       | ESLint configuration for code quality and consistency.                           |
| `firebase.json`          | Firebase project and deployment configuration.                                   |
| `firestore.indexes.json` | Firestore database index configuration.                                          |
| `firestore.rules`        | Firestore security and access-control rules.                                     |
| `package.json`           | Main project dependencies and npm scripts.                                       |
| `package-lock.json`      | Locks installed npm dependency versions.                                         |
| `test-docker-webhook.js` | Testing utility for Docker/webhook functionality.                                |
| `test-webhook.js`        | Testing utility for webhook functionality.                                       |
| `tsconfig.json`          | TypeScript compiler configuration.                                               |
| `README.md`              | Main project documentation and setup guide.                                      |
| `LICENSE`                | Proprietary license and usage restrictions for the project.                      |

### Important Application Files

```text
TrashTruck/
├── app/
│   ├── (tabs)/
│   │   ├── index.tsx
│   │   ├── explore.tsx
│   │   └── _layout.tsx
│   ├── SplashScreen.tsx
│   └── _layout.tsx
│
├── components/
│   └── ChatMessage.tsx
│
├── config/
│   └── firebase.ts
│
├── functions/
│   ├── index.js
│   └── package.json
│
├── assets/
├── constants/
├── docs/
├── hooks/
├── scripts/
└── styles/
```

## AI Chatbot Architecture

The RAG chatbot follows this general flow:

```text
User Question
     ↓
React Native Application
     ↓
Firebase Cloud Function
     ↓
Retrieve Relevant Documents from Firestore
     ↓
Groq API / LLaMA Model
     ↓
Generated Response
     ↓
TrashTrack Chat Interface
```

The retrieval process uses information stored in the TrashTrack knowledge base to provide responses relevant to the system and its users.

## Security

Sensitive information such as API keys and private credentials must **never be committed to the repository**.

Developers should:

* Store environment-specific values in `.env`.
* Keep private API keys on the backend.
* Require Firebase Authentication for protected data.
* Apply appropriate Firestore security rules.
* Restrict administrator and driver functionality based on user roles.

## Capstone Project Information

* **Course**: Capstone 2 — ITE 367 (Section D1)
* **Group Code**: SWU-004
* **Project Title**: TrashTrack — Municipal Solid Waste Management & Telemetry System (Danao City)
* **Group Members**:
  * Jimenez, Luthar James
  * Lariosa, Antonette
  * Racoma, Vince

## Contact Information

For questions, technical concerns, or project-related issues:

**TrashTrack Capstone Team**  
* **Public GitHub Repository**: https://github.com/WMROger/TrashTrack-Public  
* **GitHub Owner / Technical Contact**: **WMROger**  

Project issues and technical concerns may also be submitted through the repository's **GitHub Issues** section.

## License

**Proprietary License — All Rights Reserved**

Copyright © 2026 TrashTrack Capstone Team.

This project and its source code are proprietary and were developed for academic and Capstone purposes. Unauthorized copying, modification, distribution, publication, sublicensing, or commercial use of this software, in whole or in part, is prohibited without prior written permission from the TrashTrack Capstone Team.

Access to this repository does not grant permission to reproduce, redistribute, or use the project outside its authorized academic and development purposes.

See the `LICENSE` file for additional information.
