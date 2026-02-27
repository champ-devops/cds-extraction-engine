HOST_HOSTNAME=DWESTMAN \
CDS_RELEASEMODE=LOCALDEV \
CDS_PROJECT_NAME=cds-extraction-engine \
SERVER_PORT=7021 \
docker compose -f dev-compose.yml up --renew-anon-volumes --force-recreate --remove-orphans --build
