// In browser console, run this to get a fresh token
await window.Clerk.session.getToken()
  .then(token => console.log('Token retrieved successfully (length:', token?.length, ')'))
  .catch(err => console.error('Error:', err));
