#!/bin/bash
set -e

cd /app/gateway

echo "Starting IBKR Client Portal Gateway on port 5055..."
exec bin/run.sh root/conf.yaml
