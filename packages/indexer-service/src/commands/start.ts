import { Argv } from 'yargs'
import { database, logging, stateChannels } from '@graphprotocol/common-ts'
import { EventPayloads, EventNames, toBN } from '@connext/types'
import { formatEther } from 'ethers/utils'
import { AddressZero } from 'ethers/constants'
import express from 'express'
import morgan from 'morgan'
import { Stream } from 'stream'
import { utils } from 'ethers'

export default {
  command: 'start',
  describe: 'Start the service',
  builder: (yargs: Argv) => {
    return yargs
      .option('mnemonic', {
        describe: 'Ethereum wallet mnemonic',
        type: 'string',
      })
      .option('ethereum', {
        description: 'Ethereum node or provider URL',
        type: 'string',
      })
      .option('connext-messaging', {
        description: 'Connext messaging URL',
        type: 'string',
      })
      .option('connext-node', {
        description: 'Connext node URL',
        type: 'string',
      })
      .option('postgres-host', {
        description: 'Postgres host',
        type: 'string',
      })
      .option('postgres-port', {
        description: 'Postgres port',
        type: 'number',
        default: 5432,
      })
      .option('postgres-username', {
        description: 'Postgres username',
        type: 'string',
      })
      .option('postgres-password', {
        description: 'Postres password',
        type: 'string',
      })
      .option('postgres-database', {
        description: 'Postgres database name',
        type: 'string',
      })
      .option('port', {
        description: 'Port to serve from',
        type: 'number',
        default: 7600,
      })
      .demandOption(['mnemonic', 'ethereum', 'connext-node', 'postgres-database'])
  },
  handler: async (argv: { [key: string]: any } & Argv['argv']) => {
    let logger = logging.createLogger({ appName: 'IndexerService' })

    logger.info('Starting up')

    logger.info('Connect to database')
    let sequelize = await database.connect({
      logging: undefined,
      host: argv.postgresHost,
      port: argv.postgresPort,
      username: argv.postgresUsername,
      password: argv.postgresPassword,
      database: argv.postgresDatabase,
    })
    logger.info('Connected to database')

    logger.info('Create state channel')
    let client = await stateChannels.createStateChannel({
      sequelize,
      mnemonic: argv.mnemonic,
      ethereumProvider: argv.ethereum,
      connextMessaging: argv.connextMessaging,
      connextNode: argv.connextNode,
      logLevel: 1,
    })
    logger.info('Created state channel')

    // Temporary logic:
    //
    // 1. Listen to incoming payments
    // 2. Whenever there is an incoming payment, send it right back

    // Obtain current free balance
    let freeBalance = await client.getFreeBalance(AddressZero)
    let balance = freeBalance[client.freeBalanceAddress]
    logger.info(`Channel free balance: ${utils.formatEther(balance)}`)

    logger.info(`Signer address: ${client.freeBalanceAddress}`)
    logger.info(`Free balance address: ${client.freeBalanceAddress}`)
    logger.info(`xpub: ${client.publicIdentifier}`)

    // // Handle incoming payments
    client.on(
      EventNames.CONDITIONAL_TRANSFER_UNLOCKED_EVENT,
      (data: EventPayloads.SignedTransferUnlocked) => {
        const amount = toBN(data.amount)
        let formattedAmount = formatEther(amount as any).toString()

        logger.info(
          `Received payment ${data.paymentId} (${formattedAmount} ETH) from ${data.meta.sender}`,
        )

        setTimeout(async () => {
          try {
            logger.info(`Send ${formattedAmount} ETH back to ${data.meta.sender}`)
            let response = await client.transfer({
              amount,
              recipient: data.meta.sender,
              assetId: AddressZero,
            })
            logger.info(
              `${formattedAmount} ETH sent back to ${data.meta.sender} via payment ${response.paymentId}`,
            )
          } catch (e) {
            logger.error(
              `Failed to send payment back to ${data.meta.sender}: ${e.message}`,
            )
          }
        }, 1000)
      },
    )

    logger.info('Waiting to receive payments...')

    // Spin up a basic webserver
    let serverLogger = logger.child({ component: 'Server' })
    let serverLoggerStream = new Stream.Writable()
    serverLoggerStream._write = (chunk, _, next) => {
      serverLogger.debug(chunk.toString().trim())
      next()
    }
    serverLogger.info(`Start at port ${argv.port}`)
    let server = express()
    server.use(morgan('tiny', { stream: serverLoggerStream }))
    server.get('/', (_, res, __) => {
      res.status(200).send('Ready to roll!')
    })
    server.listen(argv.port, () => {
      serverLogger.info(`Started at port ${argv.port}`)
    })
  },
}