#!/bin/bash

# Read ports and types from .env file
IFS=',' read -ra PORTS <<< "$(grep '^PORTS=' .env | cut -d'=' -f2)"
IFS=',' read -ra TYPES <<< "$(grep '^TYPES=' .env | cut -d'=' -f2)"

# Check if the length of PORTS and TYPES arrays are the same
if [ ${#PORTS[@]} -ne ${#TYPES[@]} ]; then
  echo "The number of ports and types do not match!"
  exit 1
fi

# Start generating docker-compose.yml
cat > docker-compose.yml <<EOF
version: '3.8'
services:
EOF

# Generate services section for each port
redis_port=6379
for i in "${!PORTS[@]}"; do
  port=${PORTS[$i]}
  type=${TYPES[$i]}
cat >> docker-compose.yml <<EOF
  agent-${port}:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        - PORT=${port}
        - TYPE=${type}
        - REDIS_PORT=${redis_port}
    ports:
      - "${port}:${port}"
    networks:
      - express-network
    depends_on:
      - redis-${port}
    environment:
      - PORT=${port}
      - TYPE=${type}
      - REDIS_HOST=redis-${port}
      - REDIS_PORT=6379

  redis-${port}:
    image: redis:latest
    ports:
      - "${redis_port}:6379"
    networks:
      - express-network
EOF
  ((redis_port++))
done

# Add network section
cat >> docker-compose.yml <<EOF

networks:
  express-network:
    driver: bridge
EOF
