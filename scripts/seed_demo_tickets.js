/**
 * seed_demo_tickets.js
 * ---------------------
 * Inserts 5 realistic, active customer tickets into customer_requests.
 * None are 'completed' — they use 'queued' and 'processing' so you can
 * update them live on camera.
 *
 * Statuses used (all visible / actionable on the dashboard):
 *   3 × queued     — just arrived, AI classification already done
 *   2 × processing — assigned to an agent, actively being worked
 *
 * Run with:
 *   mongosh cognifyr_db scripts/seed_demo_tickets.js
 */

print('\n── Seeding 5 demo tickets ───────────────────────────────────────────────');

const now = new Date();
const mins = (n) => new Date(now - n * 60 * 1000);

const tickets = [
  // ── Ticket 1 ─ High-priority billing dispute, just arrived ─────────────────
  {
    originalMessage:  "Hi, I was charged twice for my subscription this month. I see two identical charges of $49.99 on my bank statement dated June 10th. Please refund the duplicate charge immediately. This is really frustrating.",
    sourceChannel:    "email",
    status:           "queued",
    categorySnapshot: "billing",
    prioritySnapshot: "high",
    customer: {
      name:       "Marcus Webb",
      email:      "marcus.webb@outlook.com",
      phone:      "+1-312-555-0182",
      externalId: "CRM-88210",
    },
    metadata:   { subject: "Double charge on account - urgent" },
    createdAt:  mins(8),
    updatedAt:  mins(8),
  },

  // ── Ticket 2 ─ Critical outage report, just arrived ─────────────────────────
  {
    originalMessage:  "Our entire team has been locked out of the platform since 4:30 AM IST. None of us can log in — we just get a blank white screen after entering credentials. We have a client demo in 2 hours and this is critical. Please escalate immediately.",
    sourceChannel:    "chat",
    status:           "queued",
    categorySnapshot: "technical",
    prioritySnapshot: "critical",
    customer: {
      name:       "Priya Nair",
      email:      "priya.nair@techflow.io",
      phone:      "+91-98765-43210",
      externalId: "ENT-00441",
    },
    metadata:   { planTier: "enterprise", affectedUsers: 23 },
    createdAt:  mins(12),
    updatedAt:  mins(12),
  },

  // ── Ticket 3 ─ Refund request, medium priority, queued ──────────────────────
  {
    originalMessage:  "I cancelled my Pro plan on June 1st but was still billed for the full month on June 5th. I cancelled well within the window mentioned in your refund policy. I would like a full refund of $29.99 to my original payment method.",
    sourceChannel:    "portal",
    status:           "queued",
    categorySnapshot: "refund",
    prioritySnapshot: "medium",
    customer: {
      name:       "Sophie Andersen",
      email:      "sophie.andersen@gmail.com",
      phone:      null,
      externalId: "USR-77302",
    },
    metadata:   { cancellationDate: "2026-06-01", chargeAmount: 29.99 },
    createdAt:  mins(25),
    updatedAt:  mins(25),
  },

  // ── Ticket 4 ─ App crash being actively investigated ────────────────────────
  {
    originalMessage:  "Your iOS app crashes every single time I try to export a report to PDF. I'm on iPhone 15 Pro, iOS 17.5.1, app version 3.2.1. I've tried reinstalling — same issue. Attaching crash log. This is blocking my daily workflow.",
    sourceChannel:    "email",
    status:           "processing",
    categorySnapshot: "technical",
    prioritySnapshot: "high",
    customer: {
      name:       "Jordan Blake",
      email:      "jordan.blake@designstudio.co",
      phone:      "+1-415-555-0249",
      externalId: "CRM-91145",
    },
    metadata:   { appVersion: "3.2.1", osVersion: "iOS 17.5.1", deviceModel: "iPhone 15 Pro" },
    createdAt:  mins(47),
    updatedAt:  mins(15),
  },

  // ── Ticket 5 ─ Feature request, actively being reviewed ─────────────────────
  {
    originalMessage:  "I'd love to see a dark mode option in the dashboard settings. I work late nights and the bright white interface is really hard on the eyes. Also, would be great if the data tables supported CSV export directly from the UI without needing the API. Both features would massively improve my daily experience.",
    sourceChannel:    "portal",
    status:           "processing",
    categorySnapshot: "feature_request",
    prioritySnapshot: "low",
    customer: {
      name:       "Ravi Shankar",
      email:      "ravi.shankar@datalytics.in",
      phone:      "+91-80100-55678",
      externalId: "USR-44019",
    },
    metadata:   { upvotes: 14, productArea: "dashboard-ui" },
    createdAt:  mins(90),
    updatedAt:  mins(30),
  },
];

const result = db.customer_requests.insertMany(tickets);
print(`✅  Inserted ${result.insertedIds ? Object.keys(result.insertedIds).length : 0} tickets.\n`);

// Print a quick summary table
print('ID                       | Status     | Priority | Category');
print('─────────────────────────────────────────────────────────────────────');
Object.values(result.insertedIds).forEach((id, i) => {
  const t = tickets[i];
  print(`${id} | ${t.status.padEnd(10)} | ${t.prioritySnapshot.padEnd(8)} | ${t.categorySnapshot}`);
});
print('\nDone. Refresh your dashboard — 5 active tickets should appear.\n');
