# Masumi Payment Service

The Masumi Payment Service provides an easy-to-use service to handle decentralized payments for AI agents. It supports a RESTful API and includes functionalities such as wallet generation, payment verification, and automated transaction handling.

[![CodeFactor](https://www.codefactor.io/repository/github/masumi-network/masumi-payment-service/badge/main)](https://www.codefactor.io/repository/github/masumi-network/masumi-payment-service/overview/main)

## Introduction

Masumi is a decentralized protocol designed to enable AI agents to collaborate and monetize their services efficiently. If you are developing an agentic service using frameworks like CrewAI, AutoGen, PhiData, LangGraph, or others, Masumi is built for you.

### Key Features:

- **Identity Management**: Establish trust and transparency by assigning an identity to your AI service.
- **Decision Logging**: Securely log agent outputs on the blockchain to ensure accountability.
- **Payments**: Facilitate agent-to-agent transactions and revenue generation.

Learn more about Masumi in our [Introduction Guide](https://docs.masumi.network/get-started/introduction).

## Documentation

Refer to the official [Masumi Docs Website](https://docs.masumi.network) for comprehensive documentation.

Additional guides can be found in the [docs](docs/) folder:

- [Configuration Guide](docs/CONFIGURATION.md)
- [Security Guidelines](docs/SECURITY.md)
- [Development and Architecture Guide](docs/DEVELOPMENT.md)
- [Deployment Guide](docs/DEPLOYMENT.md)

## System Requirements

Ensure your system meets the following requirements before installation:

- Node.js v20.x or later
- PostgreSQL 15 database

## Installing the Masumi Node

The node consists of two different repositories. We start with the Payment Service, which is key to getting started. The Registry Service is not required and is optional to run.

We are focusing on setting everything up for the **Preprod** Environment of Masumi. This is the environment you should start with to get familiar with Masumi and to connect and test your agentic services before you switch to the **Mainnet** environment.

### Step 1: Clone the Repository and Install Dependencies

```sh
git clone https://github.com/masumi-network/masumi-payment-service
cd masumi-payment-service/
npm install
```

### Step 2: Checkout the Latest Stable Version

```sh
git fetch --tags
git checkout $(git tag -l | sort -V | tail -n 1)
```

### Step 3: Configure Environment Variables

Copy the `.env.example` file to `.env` and update the following variables:

```sh
DATABASE_URL="postgresql://johndoe:randompassword@localhost:5432/masumi_payment?schema=public"
ENCRYPTION_KEY="abcdef_this_should_be_very_secure_and_32_characters_long"
ADMIN_KEY="abcdef_this_should_be_very_secure"
BLOCKFROST_API_KEY_PREPROD="your_blockfrost_api_key"
```

*optionally for mainnet add or replace `BLOCKFROST_API_KEY_PREPROD`

```sh
BLOCKFROST_API_KEY_MAINNET="your_blockfrost_api_key_for_mainnet"
```

if you want to run on mainnet. We recommend you to start on Preprod first.

If you don't know how to set up a PostgreSQL database - [learn more below](#installing-postgresql-database).

Get a free Blockfrost API Key from [blockfrost.io](https://blockfrost.io) - [learn more below](#getting-the-blockfrost-api-key).

Set the Encryption and Admin Keys yourself.

### Step 4: Configure and Seed the PostgreSQL Database

```sh
npm run prisma:migrate
npm run prisma:seed
```

### Run in Docker

```sh
docker compose up -d
```

Congratulations! You have successfully run the Masumi Payment Service in Docker.

### Run in Development Mode instead

#### Step 1: Building the Admin Interface

```sh
cd frontend
npm install
npm run build
cd ..
```

#### Step 2: Running the Node

Start the node with:

```sh
npm run build && npm start
```

Access the following (localhost) interfaces:

- [Admin Dashboard](http://localhost:3001/admin/)
- [API Documentation](http://localhost:3001/docs/)

With this setup, you have done the bare minimum to get started!

Make yourself familiar with the **Wallets Chapter** next, in order to secure your wallets. This is especially important as soon as you want to switch to **Mainnet**.

As long as you are on **Preprod**, there is nothing to worry about!

## Getting the Blockfrost API Key

Blockfrost is an API Service that allows the Masumi node to interact with the Cardano blockchain without running a full Cardano Node ourselves. It is free and easy to get:

1. Sign up on [blockfrost.io](https://blockfrost.io)
2. Click "Add Project"
3. Make sure to choose "Cardano Preprod" as Network
4. Copy and Paste the API Key

Blockfrost is free for one project and for **50,000 Requests a Day**, which is sufficient to run the node 24 hours. Should you switch to **Mainnet**, you will need to change your project.

## Installing PostgreSQL Database

If PostgreSQL is not installed, follow these steps (for MacOS):

```sh
brew install postgresql@15
brew services start postgresql@15
```

To create a database:

```sh
psql postgres
create database masumi_payment;
\q
```

Ensure that your `DATABASE_URL` matches the configured database settings.

## Masumi Registry Service

In principle, you can follow the same process to install the **Masumi Registry Service**. It will require a separate database and another adjustment of the `.env` file.

However, you can also register your agents through the **Masumi Explorer** or directly use our centrally provided registry service to get started: [http://registry.masumi.network](http://registry.masumi.network).

## Audit

The Masumi Payment Service Smart Contracts have been audited by [TxPipe](https://txpipe.io/).
Audit available [here](audit/Masumi-Payment-Service-Audit-April-2025.pdf)


## Contributing

We welcome contributions! Refer to our [Contributing Guide](CONTRIBUTING.md) for more details.

## License

This project is licensed under the MIT License.
