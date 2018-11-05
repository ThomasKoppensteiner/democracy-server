/* eslint-disable no-console */

import express from 'express';
import bodyParser from 'body-parser';
import { graphqlExpress, graphiqlExpress } from 'apollo-server-express';
import { makeExecutableSchema } from 'graphql-tools';
import { createServer } from 'http';
import { Engine } from 'apollo-engine';
import { CronJob } from 'cron';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import './services/logger';

import DB from './config/db';
import CONSTANTS from './config/constants';
import typeDefs from './graphql/schemas';
import resolvers from './graphql/resolvers';

import sendNotifications from './scripts/sendNotifications';

import { auth } from './express/auth';
import BIOupdate from './express/webhooks/bundestagio/update';
import BIOupdateProcedures from './express/webhooks/bundestagio/updateProcedures';
import debugPushNotifications from './express/webhooks/debug/pushNotifications';
import debugImportAll from './express/webhooks/debug/importAll';
import smHumanConnaction from './express/webhooks/socialmedia/humanconnection';

// Models
import ProcedureModel from './models/Procedure';
import UserModel from './models/User';
import DeviceModel from './models/Device';
import PhoneModel from './models/Phone';
import VerificationModel from './models/Verification';
import ActivityModel from './models/Activity';
import VoteModel from './models/Vote';
import PushNotifiactionModel from './models/PushNotifiaction';
import SearchTermModel from './models/SearchTerms';
import { isDataSource } from './express/auth/permissions';
import { migrate } from './migrations/scripts';

// enable cors
const corsOptions = {
  origin: '*',
  // credentials: true, // <-- REQUIRED backend setting
};

const main = async () => {
  // Migrations
  await migrate().catch(err => {
    // Log the original error
    Log.error(err.stack);
    // throw own error
    throw new Error('Migration not successful - I die now!');
  });

  // Start regular DB Connection
  await DB();

  // Express Server
  const app = express();
  if (CONSTANTS.DEBUG) {
    app.use(cookieParser());
  }

  app.use(cors(corsOptions));

  const schema = makeExecutableSchema({
    typeDefs,
    resolvers,
  });

  // Apollo Engine
  if (CONSTANTS.ENGINE_API_KEY) {
    const engine = new Engine({
      engineConfig: { apiKey: CONSTANTS.ENGINE_API_KEY },
      graphqlPort: CONSTANTS.PORT,
    });
    engine.start();
    app.use(engine.expressMiddleware());
  }

  app.use(bodyParser.json());

  // Authentification
  app.use(auth);

  // Graphiql
  if (CONSTANTS.GRAPHIQL) {
    app.use(
      CONSTANTS.GRAPHIQL_PATH,
      graphiqlExpress({
        endpointURL: CONSTANTS.GRAPHQL_PATH,
      }),
    );
  }

  // Graphql
  app.use(CONSTANTS.GRAPHQL_PATH, (req, res, next) => {
    graphqlExpress({
      schema,
      context: {
        // Connection
        res,
        // User, Device & Phone
        user: req.user,
        device: req.device,
        phone: req.phone,
        // Models
        ProcedureModel,
        UserModel,
        DeviceModel,
        PhoneModel,
        VerificationModel,
        ActivityModel,
        VoteModel,
        PushNotifiactionModel,
        SearchTermModel,
      },
      tracing: true,
      cacheControl: true,
    })(req, res, next);
  });

  // Bundestag.io
  // Webhook
  app.post('/webhooks/bundestagio/update', isDataSource.createResolver(BIOupdate));
  // Webhook update specific procedures
  app.post(
    '/webhooks/bundestagio/updateProcedures',
    isDataSource.createResolver(BIOupdateProcedures),
  );

  // Human Connection webhook
  app.get('/webhooks/human-connection/contribute', isDataSource.createResolver(smHumanConnaction));

  // Debug
  if (CONSTANTS.DEBUG) {
    // Push Notification test
    app.get('/push-test', debugPushNotifications);
    // Bundestag.io Import All
    app.get('/webhooks/bundestagio/import-all', debugImportAll);
  }

  const graphqlServer = createServer(app);
  graphqlServer.listen(CONSTANTS.PORT, err => {
    if (err) {
      Log.error(JSON.stringify({ err }));
    } else {
      Log.info(`App is listen on port: ${CONSTANTS.PORT}`);

      const cronjob = new CronJob('0 8 * * *', sendNotifications, null, true, 'Europe/Berlin');

      const cronjob2 = new CronJob('45 19 * * *', sendNotifications, null, true, 'Europe/Berlin');
      Log.info(
        JSON.stringify({
          cronjob: cronjob.running,
          cronjob2: cronjob2.running,
        }),
      );
    }
  });
};

// Async Wrapping Function
// Catches all errors
(async () => {
  try {
    await main();
  } catch (error) {
    Log.error(error.stack);
  }
})();
