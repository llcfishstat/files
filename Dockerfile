FROM node:14.8.0-alpine
RUN npm install -g npm@6.14.7
RUN mkdir -p /var/www/files
WORKDIR /var/www/files
ADD . /var/www/files
RUN npm install
CMD npm start