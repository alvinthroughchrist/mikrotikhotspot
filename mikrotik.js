const fs = require('fs');
const RouterOSClient = require('routeros-api').RouterOSClient;

function loadConfig() {
  try {
    return require('./config.json');
  } catch (error) {
    return require('./config.example.json');
  }
}

const config = loadConfig();
const routerConfig = {
  host: config.routeros.host,
  user: config.routeros.user,
  password: config.routeros.password,
  port: config.routeros.port || 8728,
  keepalive: true
};

async function addHotspotUser(username, password, limitUptime, profile) {
  const api = new RouterOSClient(routerConfig);
  const client = await api.connect();
  const hotspotMenu = client.menu('/ip/hotspot/user');
  await hotspotMenu.add({
    name: username,
    password,
    profile: profile || config.routeros.hotspotProfile || 'default',
    'limit-uptime': limitUptime
  });
  await api.close();
}

module.exports = {
  addHotspotUser
};
