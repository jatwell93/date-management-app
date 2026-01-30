import dotenv from 'dotenv';
import { exit } from 'process';

// Load environment-specific configuration
dotenv.config({ path: `.env.${process.env.NODE_ENV}` });
dotenv.config(); // Load default .env file

interface EnvironmentConfig {
  NODE_ENV: string;
  PORT: number;
  JWT_SECRET: string;
  DATABASE_PATH: string;
  FRONTEND_URL: string;
  USE_HTTPS: boolean;
  DEFAULT_PIN: string;
  SSL_PRIVATE_KEY_PATH?: string;
  SSL_CERT_PATH?: string;
  // Add other required environment variables as needed
}

function validateEnvironment(): EnvironmentConfig {
  const requiredEnvVars = [
    'NODE_ENV',
    'PORT',
    'JWT_SECRET',
    // DATABASE_PATH and FRONTEND_URL are optional, will default if not provided
  ];

  const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);

  if (missingEnvVars.length > 0) {
    console.error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
    exit(1);
  }

  // Validate PORT is a number
  const port = parseInt(process.env.PORT as string, 10);
  if (isNaN(port) || port <= 0) {
    console.error(
      `Invalid PORT environment variable: ${process.env.PORT}. Must be a positive number.`,
    );
    exit(1);
  }

  // Validate JWT_SECRET is not empty
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim() === '') {
    console.error('JWT_SECRET environment variable is empty');
    exit(1);
  }

  // Validate NODE_ENV is one of the expected values
  const validEnvironments = ['development', 'staging', 'production', 'test'];
  if (!validEnvironments.includes(process.env.NODE_ENV as string)) {
    console.error(`NODE_ENV must be one of: ${validEnvironments.join(', ')}`);
    exit(1);
  }

  return {
    NODE_ENV: process.env.NODE_ENV as string,
    PORT: port,
    JWT_SECRET: process.env.JWT_SECRET as string,
    DATABASE_PATH: process.env.DATABASE_PATH || './database.sqlite', // Default to local database file
    FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000', // Default to local frontend during development
    DEFAULT_PIN: process.env.DEFAULT_PIN || '5624', // Default PIN for dev environment
    USE_HTTPS: process.env.USE_HTTPS === 'true',
    SSL_PRIVATE_KEY_PATH: process.env.SSL_PRIVATE_KEY_PATH,
    SSL_CERT_PATH: process.env.SSL_CERT_PATH,
  };
}

export const envConfig = validateEnvironment();
