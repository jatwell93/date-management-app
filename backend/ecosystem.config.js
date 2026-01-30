module.exports = {
  apps: [
    {
      name: 'date-management-backend',
      script: './dist/index.js',
      instances: 'max', // Use all CPU cores
      exec_mode: 'cluster', // Use cluster mode for better performance
      env: {
        NODE_ENV: 'development',
        PORT: 3001,
        JWT_SECRET: 'your_jwt_secret', // Should be overridden in production
        DATABASE_PATH: './database.sqlite',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
        JWT_SECRET: process.env.JWT_SECRET, // Use environment variable in production
        DATABASE_PATH: './database.sqlite',
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true,
      max_restarts: 5,
      min_uptime: '10s',
      max_memory_restart: '512M', // Restart if memory usage exceeds 512MB
    },
  ],
};
