// Inspect all distinct categorySnapshot values currently in the DB
const snap = db.customer_requests.aggregate([
  { $group: { _id: { status: "$status", categorySnapshot: "$categorySnapshot" }, count: { $sum: 1 } } },
  { $sort: { "_id.status": 1 } }
]).toArray();
printjson(snap);
