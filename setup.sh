#!/bin/bash

# ============================================
# Gmail Tool - VPS Auto Setup (Batch Update)
# ============================================

REPO_URL="https://github.com/gaurav-kakwan/anuj-pelu.git"
APP_DIR="/var/www/gmail-tool"
APP_NAME="gmail-tool"

echo "======================================"
echo "  Gmail Tool - VPS Setup"
echo "======================================"

# 1. System update
echo ""
echo "[1/6] Updating system..."
apt-get update -y > /dev/null 2>&1
apt-get upgrade -y > /dev/null 2>&1

# 2. Install Node.js 20.x
echo "[2/6] Installing Node.js..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
    apt-get install -y nodejs > /dev/null 2>&1
fi
echo "      Node: $(node -v)"
echo "      NPM:  $(npm -v)"

# 3. Install Nginx
echo "[3/6] Installing Nginx..."
apt-get install -y nginx > /dev/null 2>&1
systemctl enable nginx > /dev/null 2>&1
systemctl start nginx > /dev/null 2>&1

# 4. Install PM2 globally
echo "[4/6] Installing PM2..."
npm install -g pm2 > /dev/null 2>&1
echo "      PM2: $(pm2 -v)"

# 5. Clone/Update app
echo "[5/6] Setting up app..."
if [ -d "$APP_DIR" ]; then
    echo "      Updating existing code..."
    cd $APP_DIR
    git pull origin main > /dev/null 2>&1
else
    echo "      Cloning from GitHub..."
    mkdir -p /var/www
    git clone $REPO_URL $APP_DIR > /dev/null 2>&1
    cd $APP_DIR
fi

# Install Dependencies (Express, Nodemailer)
npm install --production > /dev/null 2>&1

# 6. PM2 start/restart
echo "[6/6] Starting app with PM2..."
pm2 delete $APP_NAME > /dev/null 2>&1
pm2 start server.js --name $APP_NAME > /dev/null 2>&1
pm2 save > /dev/null 2>&1
pm2 startup systemd -u root --hp /root > /dev/null 2>&1

# Nginx Config
echo ""
echo "Configuring Nginx..."

cat > /etc/nginx/sites-available/gmail-tool << 'NGINX'
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
        
        # Timeout settings for long sending processes
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        proxy_connect_timeout 300s;
    }
}
NGINX

# Remove default, enable ours
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/gmail-tool /etc/nginx/sites-enabled/gmail-tool

# Test and restart Nginx
nginx -t > /dev/null 2>&1
systemctl restart nginx

# Firewall
ufw allow 80/tcp > /dev/null 2>&1
ufw allow 22/tcp > /dev/null 2>&1
ufw --force enable > /dev/null 2>&1

# Get IP
IP=$(curl -s ifconfig.me 2>/dev/null || echo "YOUR_IP_ADDRESS")

echo ""
echo "======================================"
echo "  SETUP COMPLETE!"
echo "======================================"
echo ""
echo "  Live URL: http://$IP"
echo "  App Dir:  $APP_DIR"
echo "  PM2 Logs: pm2 logs $APP_NAME"
echo "  Restart:  pm2 restart $APP_NAME"
echo ""
echo "======================================"