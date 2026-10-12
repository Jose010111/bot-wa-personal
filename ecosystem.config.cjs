module.exports = {
  apps: [
    {
      name: 'whatsapp-personal-reminder',
      script: 'index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      stop_exit_codes: [0],
      restart_delay: 5000,
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
