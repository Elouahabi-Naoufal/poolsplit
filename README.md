<a id="readme-top"></a>

[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![MIT License][license-shield]][license-url]
[![LinkedIn][linkedin-shield]][linkedin-url]

<br />
<div align="center">
  <a href="https://github.com/Elouahabi-Naoufal/poolsplit">
    <img src="public/logo.png" alt="PoolSplit logo" width="80" height="80">
  </a>

  <h3 align="center">PoolSplit</h3>

  <p align="center">
    Plan group outings, track who paid and who consumed, and settle up without the awkward math.
    <br />
    <a href="https://github.com/Elouahabi-Naoufal/poolsplit"><strong>Explore the source »</strong></a>
    <br />
    <br />
    <a href="https://github.com/Elouahabi-Naoufal/poolsplit/issues/new?labels=bug">Report Bug</a>
    &middot;
    <a href="https://github.com/Elouahabi-Naoufal/poolsplit/issues/new?labels=enhancement">Request Feature</a>
  </p>
</div>

<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

## About The Project

PoolSplit is a group expense splitter built around outings and activities rather than one flat
group ledger. A group is a persistent membership container; an outing is an independent financial
context inside it; activities are the things people actually spend money on.

Core behaviour:

* **Groups and outings** with invitations by public ID or QR code
* **Flexible pricing** — fixed per-unit activities or variable line-item expenses
* **Per-activity participation**, so people who skipped an activity are not charged for it
* **Contributions and payments tracked separately** — who consumed versus who actually paid
* **Debt simplification** that computes the minimal set of settlement transfers
* **Wallet** with deposits, balances and contribution history
* **Trilingual UI** in English, French and Arabic, with full RTL support
* **Themes** including light, dark and friendship color modes
* **Public settlement links** that can be shared without signing in
* **Correction requests, activity templates, audit events and an admin surface**

Money is stored as integer centimes throughout, and equal allocation uses a largest-remainder
method so remainders are distributed one centime at a time.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Built With

* [![Next.js][Next.js]][Next-url]
* [![React][React.js]][React-url]
* [![TypeScript][TypeScript]][TypeScript-url]
* [![Tailwind CSS][TailwindCSS]][TailwindCSS-url]
* [![Prisma][Prisma]][Prisma-url]
* [![SQLite][SQLite]][SQLite-url]
* [![Docker][Docker]][Docker-url]

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Getting Started

### Prerequisites

* Node.js 20+ and npm
* SQLite (no separate database server required)
* Docker and Docker Compose for the containerised deployment

### Installation

1. Clone the repository
   ```sh
   git clone https://github.com/Elouahabi-Naoufal/poolsplit.git
   cd poolsplit
   ```

2. Create the environment file
   ```sh
   cp .env.example .env
   ```
   Set `JWT_SECRET` to a long random value. `DATABASE_URL` defaults to a local SQLite file.

3. Install dependencies
   ```sh
   npm install
   ```

4. Create the database and generate the Prisma client
   ```sh
   npx prisma migrate dev
   npx prisma generate
   ```

5. Optionally seed development data
   ```sh
   npm run seed
   ```

6. Start the development server
   ```sh
   npm run dev
   ```

7. Open <http://localhost:3000>

Docker:
```sh
mkdir -p data
docker compose up --build -d
```
The compose stack exposes the app on port `3003`, applies migrations on startup, enables SQLite
WAL mode and persists data in the `hesab-data` named volume.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Usage

1. Register an account and create a group.
2. Invite members by public ID or QR code.
3. Create an outing inside the group, then add activities to it.
4. Choose a fixed per-unit model or add variable line items, and record who participated.
5. Record who contributed or paid, and deposit funds into the wallet when needed.
6. Finalize the outing to calculate settlement transfers, confirm them, and share the public
   settlement link if desired.
7. Use the language switcher for English, French or Arabic; the Arabic locale renders RTL.

Useful commands:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Start the production build |
| `npm run lint` | ESLint |
| `npm test` | Vitest suite |
| `npm run test:e2e` | End-to-end flow script |
| `npm run seed` | Seed development data |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Roadmap

- [x] Groups, outings, invitations and QR joins
- [x] Fixed and variable activity pricing with per-activity participation
- [x] Contributions, payments, wallet and settlement simplification
- [x] English, French and Arabic UI with RTL support
- [x] Public settlement links and admin views
- [x] Docker deployment with automatic migrations and persistent storage
- [ ] Expand automated coverage around settlement and wallet edge cases
- [ ] Add a documented scheduled backup routine on top of `scripts/backup.sh`

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contributing

Contributions are what make the open source community such an amazing place to learn, inspire,
and create. Any contributions you make are **greatly appreciated**.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

### Top contributors:

<a href="https://github.com/Elouahabi-Naoufal/poolsplit/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Elouahabi-Naoufal/poolsplit" alt="contrib.rocks image" />
</a>

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## License

Distributed under the MIT License. See `LICENSE` for more information.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contact

Naoufal Elouahabi - [LinkedIn](https://www.linkedin.com/in/elouahabi-naoufal/) - elouahabi-naoufal1@gmail.com

Project Link: [https://github.com/Elouahabi-Naoufal/poolsplit](https://github.com/Elouahabi-Naoufal/poolsplit)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Acknowledgments

* [Next.js](https://nextjs.org/)
* [Prisma](https://www.prisma.io/)
* [next-intl](https://next-intl.dev/)
* [Best-README-Template](https://github.com/othneildrew/Best-README-Template)
* [Img Shields](https://shields.io)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

[contributors-shield]: https://img.shields.io/github/contributors/Elouahabi-Naoufal/poolsplit.svg?style=for-the-badge
[contributors-url]: https://github.com/Elouahabi-Naoufal/poolsplit/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/Elouahabi-Naoufal/poolsplit.svg?style=for-the-badge
[forks-url]: https://github.com/Elouahabi-Naoufal/poolsplit/network/members
[stars-shield]: https://img.shields.io/github/stars/Elouahabi-Naoufal/poolsplit.svg?style=for-the-badge
[stars-url]: https://github.com/Elouahabi-Naoufal/poolsplit/stargazers
[issues-shield]: https://img.shields.io/github/issues/Elouahabi-Naoufal/poolsplit.svg?style=for-the-badge
[issues-url]: https://github.com/Elouahabi-Naoufal/poolsplit/issues
[license-shield]: https://img.shields.io/github/license/Elouahabi-Naoufal/poolsplit.svg?style=for-the-badge
[license-url]: https://github.com/Elouahabi-Naoufal/poolsplit/blob/main/LICENSE
[linkedin-shield]: https://img.shields.io/badge/-LinkedIn-black.svg?style=for-the-badge&logo=linkedin&colorB=555
[linkedin-url]: https://www.linkedin.com/in/elouahabi-naoufal/
[Next.js]: https://img.shields.io/badge/next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white
[Next-url]: https://nextjs.org/
[React.js]: https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB
[React-url]: https://react.dev/
[TypeScript]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[TypeScript-url]: https://www.typescriptlang.org/
[TailwindCSS]: https://img.shields.io/badge/Tailwind%20CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white
[TailwindCSS-url]: https://tailwindcss.com/
[Prisma]: https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white
[Prisma-url]: https://www.prisma.io/
[SQLite]: https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white
[SQLite-url]: https://www.sqlite.org/
[Docker]: https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white
[Docker-url]: https://www.docker.com/
