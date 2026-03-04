console.log('Environment variables:');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');
console.log('NEON_CONNECTION_STRING:', process.env.NEON_CONNECTION_STRING ? 'SET' : 'NOT SET');
console.log('DATABASE_PROVIDER:', process.env.DATABASE_PROVIDER || 'undefined');

// Check if we're in Doppler
if (process.env.DOPPLER_PROJECT) {
  console.log('\nDoppler Environment:');
  console.log('Project:', process.env.DOPPLER_PROJECT);
  console.log('Config:', process.env.DOPPLER_CONFIG);
}
