# 🏆 Hackathon Management System — Production Portal

A secure, high-concurrency Hackathon Management Web Application designed for **60 participating teams** and **hackathon administrators / judges**.

Configured with live Firebase Project: **`hackathon-6937b`**.

Built with **React + Vite + TypeScript**, **Ant Design 5**, **Firebase** (Authentication, Firestore, Cloud Storage, Cloud Functions, Analytics), strict **Security Rules**, and **Asia/Kolkata (IST)** timezone synchronization.

---

## ⚡ Live Firebase Configuration

- **Project ID**: `hackathon-6937b`
- **Auth Domain**: `hackathon-6937b.firebaseapp.com`
- **Storage Bucket**: `hackathon-6937b.firebasestorage.app`
- **Measurement ID**: `G-QLC93JXYJ6`

---

## 🚀 Running Locally

### 1. Start Development Server
```bash
npm run dev
```

### 2. Build for Production
```bash
npm run build
npm --prefix functions run build
```

### 3. Deploying Security Rules & Functions to Firebase (Optional)
```bash
# Login to your Firebase CLI account
firebase login

# Deploy Security Rules & Indexes
firebase deploy --only firestore:rules,storage,firestore:indexes

# Deploy Cloud Functions
firebase deploy --only functions
```

---

## 🔑 Demo & Test Credentials

The application is pre-configured with quick test accounts:

| Role | Username / Identifier | Password | Destination |
|---|---|---|---|
| **Admin** | `admin` | `admin123` | Full Admin Console (`/admin/dashboard`) |
| **Team 1** | `TEAM001` | `pass123` | AI Warriors Workspace (`/team/dashboard`) |
| **Team 2** | `TEAM002` | `pass123` | Tech Titans Workspace (`/team/dashboard`) |

---

## 🔒 Acceptance Criteria Checklist

- [x] Admin can create team accounts without opening Firebase Console
- [x] Team can log in with created credentials
- [x] Team users cannot access `/admin/*` pages (automatic redirect)
- [x] Team 001 cannot view Team 002 submissions or scores
- [x] Team cannot modify marks or round status
- [x] Admin can start and stop Round 1, 2, and 3
- [x] Stopped rounds immediately reject uploads server-side
- [x] Deadlines validated against server time
- [x] Admin can view and evaluate submissions with 100-mark rubrics
- [x] Teams can view only their own scorecards and feedback
- [x] Admin can trigger Force Logout and Disable Account
- [x] Second device login invalidates previous active session
- [x] Passwords never stored or logged in plaintext
- [x] Firebase Admin credentials kept strictly server-side
- [x] Storage and Firestore rules enforce least-privilege security
- [x] Audit logs record all administrative actions
- [x] Leaderboard calculates rankings with deterministic tie-breaking
- [x] Responsive layout on Desktop, Tablet, and Mobile
