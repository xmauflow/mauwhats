FROM node:20.19

WORKDIR /usr/src/app

COPY package*.json ./

COPY . .

RUN npm install

CMD npm start
