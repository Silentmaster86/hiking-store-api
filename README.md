# Hiking Store API — Backend for E-commerce Portfolio Project

REST API backend for the **Hiking Store** e-commerce application.  
This service provides product data, cart management, checkout flow, orders, and authentication.

The API is designed to simulate a real production backend and demonstrates how a frontend React application integrates with server-side logic, sessions, and a PostgreSQL database.

Frontend demo:  
https://hiking-store-uk.netlify.app

---

## 🎯 Project Purpose

This backend was built to:

- Provide a realistic API for a React frontend
- Handle session-based carts (guest + logged-in users)
- Manage checkout & orders
- Implement authentication and OAuth
- Demonstrate backend architecture for a portfolio project
- Show how frontend and backend integrate in a real-world setup

---

## 🧱 Tech Stack

- Node.js
- Express
- PostgreSQL
- express-session
- connect-pg-simple
- Passport.js
- bcrypt
- CORS + secure cookies
- Hosted on Render

---

## 🛠 Core Features

### 🛍 Products

- Fetch all products
- Fetch single product by ID
- Category-based filtering (handled in frontend)

Endpoints:
- `GET /products`
- `GET /products/:id`

---

### 🛒 Cart (Session-based)

- Guest cart stored in server session
- Logged-in user cart stored in database
- Automatic merge of guest cart after login
- Quantity updates
- Persistent cart across reloads

Endpoints:
- `GET /cart`
- `POST /cart/items`
- `PUT /cart/items/:id`
- `DELETE /cart/items/:id`

---

### ✅ Checkout

- Guest checkout supported
- Order creation in PostgreSQL
- Cart is cleared after successful checkout

Endpoint:
- `POST /checkout`

---

### 📦 Orders

- Orders stored in database
- Order details protected by authentication
- Order history per user

Endpoints:
- `GET /orders`
- `GET /orders/:id`

---

### 🔐 Authentication

#### Local Authentication

- Email + password registration
- Secure password hashing (bcrypt)
- Session-based login

Endpoints:
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`

#### OAuth (Passport.js)

- Google OAuth
- Facebook OAuth

Endpoints:
- `GET /auth/google`
- `GET /auth/google/callback`
- `GET /auth/facebook`
- `GET /auth/facebook/callback`

---

## 🗄 Database

PostgreSQL schema includes:

- users
- products
- carts
- cart_items
- orders
- order_items
- session (for express-session)

Supports:

- Guest + authenticated carts
- Order history
- Secure user accounts
- Persistent sessions

---

## 🔑 Environment Variables

Create a `.env` file with:

- `DATABASE_URL=postgres://...`
- `SESSION_SECRET=your_secret`
- `CORS_ORIGIN=https://hiking-store-uk.netlify.app`
- `GOOGLE_CLIENT_ID=...`
- `GOOGLE_CLIENT_SECRET=...`
- `GOOGLE_CALLBACK_URL=https://your-api.onrender.com/auth/google/callback`
- `FB_APP_ID=...`
- `FB_APP_SECRET=...`
- `FB_CALLBACK_URL=https://your-api.onrender.com/auth/facebook/callback`

---

## ▶️ Running Locally

1) Install dependencies:
- `npm install`

2) Run the API:
- `npm run dev`

Make sure PostgreSQL is running and `DATABASE_URL` is set correctly.

---

## 🏗 Architecture Notes

- Session cookies used instead of JWT to simulate traditional e-commerce flows
- Guest → user cart merge logic
- OAuth handled via Passport strategies
- Database-backed session store for persistence
- Secure cookies for Netlify + Render deployment
- CORS configured for cross-domain frontend + backend setup

---

## 🎯 Project Scope

This backend intentionally focuses on **core e-commerce backend logic** and does not include:

- Payments (Stripe, PayPal, etc.)
- Admin panel
- Product management UI
- Inventory tracking
- Email notifications

---

## 👤 Author

**Przemysław Pietkun**  
Junior Frontend Developer — Fullstack Portfolio Project

GitHub:  
https://github.com/Silentmaster86

Portfolio:  
https://silent86.netlify.app

---

This backend API is part of a full-stack portfolio project and demonstrates practical integration between a modern React frontend and a Node.js + PostgreSQL backend.
```0
