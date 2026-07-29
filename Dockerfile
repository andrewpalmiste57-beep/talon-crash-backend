# Use nginx to serve static HTML
FROM nginx:alpine

# Copy your HTML file(s) into nginx's web root
COPY . /usr/share/nginx/html

# Expose port 80
EXPOSE 80

# Nginx runs automatically — keeps the container alive
CMD ["nginx", "-g", "daemon off;"]

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["npm", "start"]
