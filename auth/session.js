// Only guest order grants survive a logout. Account carts stay with the account.
function guestState(session) {
  return { ...(session.guestOrders ? { guestOrders: session.guestOrders } : {}),
    ...(session.checkoutOwner ? { checkoutOwner: session.checkoutOwner } : {}) };
}

function regenerateSession(req, values = {}) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      Object.assign(req.session, values);
      resolve();
    });
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

async function logout(req) {
  if (!req.session.userId && !req.session.passport?.user) return;
  await regenerateSession(req, guestState(req.session));
  req.user = undefined;
  await saveSession(req);
}

module.exports = { guestState, regenerateSession, saveSession, logout };
