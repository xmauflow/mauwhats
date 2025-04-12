FROM nikolaik/python-nodejs:python3.10-nodejs19

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 3000

RUN npm install

CMD npm start