// In browser console, run this to get a fresh token
await window.Clerk.session.getToken()
  .then(token => console.log('Fresh token:', token))
  .catch(err => console.error('Error:', err));
