# ADR-0001: Modulär monolit med separata skal

- Status: Accepterad
- Datum: 2026-08-30

## Kontext

O-Tid behöver ett webb/API-skal, en framtida stationsklient och en worker, men
TASK 001 kräver ett litet reproducerbart repository utan distribuerad driftbörda.

## Beslut

Vi använder en pnpm-workspace utan Turborepo. `apps/web` och `apps/worker` är
separata processer ur samma kodbas. Ren domän, kontrakt, import, databas och
applikationstjänster ligger i paket med enkelriktade beroenden.

## Konsekvenser

Alla moduler kan testas separat men deployas tillsammans. Inga mikrotjänster,
Redis, GraphQL eller serverless-only-funktioner införs. Om processgränser senare
ändras krävs ny ADR.
