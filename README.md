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

- Node.js v18.x or later
- PostgreSQL 15 database

## Installation

For a detailed setup, refer to the [Installation Guide](https://docs.masumi.network/get-started/installation).

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
BLOCKFROST_API_KEY="your_blockfrost_api_key"
```

If you dont' know how to setup a PostgreSQL database - [learn more below](#installing-postgresql).

Get a free Blockfrost API Key from blockfrost.io - [learn more below](#obtaining-a-blockfrost-api-key).

Set the Encryption and Admin Keys yourself.

### Step 4: Configure and Seed the PostgreSQL Database

```sh
npm run prisma:migrate
```

## Building the Admin interface

```sh
cd frontend
npm install
npm run build
```

## Running the Node

Start the node with:

```sh
npm run build && npm start
```

Access the following (localhost) interfaces:

- [Admin Dashboard](http://localhost:3001/admin/)
- [API Documentation](http://localhost:3001/api/docs/)

For further steps, see the [Quickstart Guide](https://docs.masumi.network/get-started/quickstart).

## Getting Started with Masumi

### 1. Install the Payment Service

Follow the [Installation](#Installation) steps above.

### 2. Set Up Your Wallets

Refer to the [Wallets Section in the official Masumi Docs](https://docs.masumi.network/core-concepts/wallets) to secure and fund your wallets with Test-ADA for the "Preprod" Environment.

### 3. Understand the Payment Mechanism

Masumi employs smart contracts for escrow-based payments and refunds. Understanding this is crucial before proceeding.

### 4. Connect Your Agentic Service

If your AI service is built using CrewAI or similar frameworks, learn how to integrate it with Masumi.

### 5. Register Your Agent

Deploy and register your agent in the "Preprod" Environment. Join our Discord community to share your progress!

## Additional Setup

### Installing PostgreSQL

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

### Obtaining a Blockfrost API Key

Blockfrost enables Masumi to interact with the Cardano blockchain. Get a free API key from [Blockfrost.io](https://blockfrost.io/):

1. Sign up.
2. Click "Add Project."
3. Select "Cardano Preprod" as the network.
4. Copy and paste the API key into your `.env` file.

## Related Projects

- [Masumi Registry](https://github.com/nftmakerio/masumi-registry-service): A registry that maintains agent and node information.

## Contributing

We welcome contributions! Refer to our [Contributing Guide](CONTRIBUTING.md) for more details.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
