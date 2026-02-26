# API Documentation

## OpenAPI Specification
This API is documented using OpenAPI. The complete specification can be found at:
- **OpenAPI Spec URL**: http://localhost:7001/v1/documentation/json
- **API Base URL**: http://localhost:7001/v1
- **API Title**: CDS Core API
- **Version**: 1.0.0
- **Description**: Champion Data Solutions Core API

## Authentication
- **Bearer Auth**: Used for admin endpoints
- **Customer Auth**: Used for customer session endpoints

## Key Endpoints

### Health
- **GET    /hello/** - Health check endpoint

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Properties**:
      - `result` (string) - Greeting message


### Telegraf
- **GET    /telegraf/hit** - Get internal tracking counters (formatted)

  **Schema Details:**
  **Response 200:**
    **Type**: object

- **GET    /telegraf/internalTrackingCounters** - Get internal tracking counters (raw)

  **Schema Details:**
  **Response 200:**
    **Type**: object

- **GET    /telegraf/dbPoolStats** - Get database pool statistics

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Properties**:
      - `poolSize` (number)
      - `available` (number)
      - `pending` (number)
      - `active` (number)
      - `maxPoolSize` (number)
  **Response 500:**
    **Type**: object
    **Properties**:
      - `error` (string)

- **GET    /telegraf/redisStats** - Get Redis statistics

  **Schema Details:**
  **Response 200:**
    **Type**: object
  **Response 400:**
    **Type**: object
    **Properties**:
      - `error` (string)

- **GET    /telegraf/redisInfo** - Get Redis info text

  **Schema Details:**
  **Response 200:**
    **Type**: string
  **Response 400:**
    **Type**: object
    **Properties**:
      - `error` (string)

- **GET    /telegraf/jobQueueProducerStats** - Get job queue producer statistics

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Properties**:
      - `activeJobsCount` (number)
      - `archivedJobsCount` (number)
      - `completedJobsCount` (number)
      - `deletedJobsCount` (number)

- **GET    /telegraf/mongooseStats** - Get Mongoose statistics

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Properties**:
      - `poolSize` (number)
      - `available` (number)
      - `pending` (number)
      - `active` (number)
      - `maxPoolSize` (number)
  **Response 500:**
    **Type**: object
    **Properties**:
      - `error` (string)

- **GET    /telegraf/changeStreamStats** - Get change stream statistics

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Properties**:
      - `isReady` (boolean)
      - `activeStreamCount` (number)
      - `activeStreams` (object)
      - `configuredStreamCount` (number)
  **Response 500:**
    **Type**: object
    **Properties**:
      - `error` (string)


### Messages S M S M M S
- **GET    /messagesSMSMMS/messages** - Get all SMS/MMS messages

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **GET    /messagesSMSMMS/messages/{id}** - Get a specific message by ID

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `id` (number) - id
      - `direction` (string) - direction
      - `record_type` (string) - record_type
      - `type` (string) - type
      - `from` (string) - from
      - `to` (string) - to
      - `text` (string) - text
      - `received_at` (string) - received_at
      - `media` (array) - media
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **POST   /messagesSMSMMS/received** - Receive a new incoming message

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `id` (number) - id
      - `direction` (string) - direction
      - `record_type` (string) - record_type
      - `type` (string) - type
      - `from` (string) - from
      - `to` (string) - to
      - `text` (string) - text
      - `received_at` (string) - received_at
      - `media` (array) - media
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt
  **Response 201:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `id` (number) - id
      - `direction` (string) - direction
      - `record_type` (string) - record_type
      - `type` (string) - type
      - `from` (string) - from
      - `to` (string) - to
      - `text` (string) - text
      - `received_at` (string) - received_at
      - `media` (array) - media
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **POST   /messagesSMSMMS/sent** - Send a new outgoing message

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `id` (number) - id
      - `direction` (string) - direction
      - `record_type` (string) - record_type
      - `type` (string) - type
      - `from` (string) - from
      - `to` (string) - to
      - `text` (string) - text
      - `received_at` (string) - received_at
      - `media` (array) - media
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt
  **Response 201:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `id` (number) - id
      - `direction` (string) - direction
      - `record_type` (string) - record_type
      - `type` (string) - type
      - `from` (string) - from
      - `to` (string) - to
      - `text` (string) - text
      - `received_at` (string) - received_at
      - `media` (array) - media
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **POST   /messagesSMSMMS/update/{id}** - Update a message by ID

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `id` (number) - id
      - `direction` (string) - direction
      - `record_type` (string) - record_type
      - `type` (string) - type
      - `from` (string) - from
      - `to` (string) - to
      - `text` (string) - text
      - `received_at` (string) - received_at
      - `media` (array) - media
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt
  **Response 200:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `id` (number) - id
      - `direction` (string) - direction
      - `record_type` (string) - record_type
      - `type` (string) - type
      - `from` (string) - from
      - `to` (string) - to
      - `text` (string) - text
      - `received_at` (string) - received_at
      - `media` (array) - media
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **GET    /messagesSMSMMS/incoming** - Get all incoming messages

  **Schema Details:**
  **Response 200:**
    **Type**: array


### Customers
- **GET    /customers/admin/all** - No description

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **GET    /customers/** - Get current customer information

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `legacyCustomerID` (string) - legacyCustomerID
      - `customerName` (string) - customerName
      - `customerID` (string) - customerID
      - `accessID` (string) - accessID
      - `timezone` (string) - timezone
      - `legacyCustomerEventAreaMask` (number) - legacyCustomerEventAreaMask
      - `legacyCustomerOtherAreaMask` (number) - legacyCustomerOtherAreaMask
      - `legacyECCustomerID` (number) - legacyECCustomerID
      - `contactInfo` (object)
      - `roles` (array) - roles
      - `startDate` (string) - startDate
      - `endDate` (string) - endDate
      - `services` (array) - services
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **GET    /customers/accessID/{accessID}** - Get customer by access ID

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `legacyCustomerID` (string) - legacyCustomerID
      - `customerName` (string) - customerName
      - `customerID` (string) - customerID
      - `accessID` (string) - accessID
      - `timezone` (string) - timezone
      - `legacyCustomerEventAreaMask` (number) - legacyCustomerEventAreaMask
      - `legacyCustomerOtherAreaMask` (number) - legacyCustomerOtherAreaMask
      - `legacyECCustomerID` (number) - legacyECCustomerID
      - `contactInfo` (object)
      - `roles` (array) - roles
      - `startDate` (string) - startDate
      - `endDate` (string) - endDate
      - `services` (array) - services
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt


### Customer  Services
- **POST   /customers/admin/{customerID}/services/update** - Update customer services

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Required**: services
    **Properties**:
      - `services` (array) (required) - Array of service names for the customer
  **Response 200:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `legacyCustomerID` (string) - legacyCustomerID
      - `customerName` (string) - customerName
      - `customerID` (string) - customerID
      - `accessID` (string) - accessID
      - `timezone` (string) - timezone
      - `legacyCustomerEventAreaMask` (number) - legacyCustomerEventAreaMask
      - `legacyCustomerOtherAreaMask` (number) - legacyCustomerOtherAreaMask
      - `legacyECCustomerID` (number) - legacyECCustomerID
      - `contactInfo` (object)
      - `roles` (array) - roles
      - `startDate` (string) - startDate
      - `endDate` (string) - endDate
      - `services` (array) - services
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **GET    /customers/admin/{customerID}/services** - Get customer services

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Properties**:
      - `services` (array) - Array of service names for the customer


### Customer  Roles
- **POST   /customers/roles/new** - Add a new role to the current customer

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Required**: name
    **Properties**:
      - `name` (string) (required) - Role name/identifier
      - `permissions` (object) - Map of area => array of permission strings
      - `isUseDefault` (boolean) - Whether this role should use default permissions
  **Response 201:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `legacyCustomerID` (string) - legacyCustomerID
      - `customerName` (string) - customerName
      - `customerID` (string) - customerID
      - `accessID` (string) - accessID
      - `timezone` (string) - timezone
      - `legacyCustomerEventAreaMask` (number) - legacyCustomerEventAreaMask
      - `legacyCustomerOtherAreaMask` (number) - legacyCustomerOtherAreaMask
      - `legacyECCustomerID` (number) - legacyECCustomerID
      - `contactInfo` (object)
      - `roles` (array) - roles
      - `startDate` (string) - startDate
      - `endDate` (string) - endDate
      - `services` (array) - services
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **POST   /customers/roles/{roleID}/update** - Update an existing customer role

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Properties**:
      - `name` (string) - Role name/identifier
      - `permissions` (object) - Map of area => array of permission strings
      - `isUseDefault` (boolean) - Whether this role should use default permissions
  **Response 200:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `legacyCustomerID` (string) - legacyCustomerID
      - `customerName` (string) - customerName
      - `customerID` (string) - customerID
      - `accessID` (string) - accessID
      - `timezone` (string) - timezone
      - `legacyCustomerEventAreaMask` (number) - legacyCustomerEventAreaMask
      - `legacyCustomerOtherAreaMask` (number) - legacyCustomerOtherAreaMask
      - `legacyECCustomerID` (number) - legacyECCustomerID
      - `contactInfo` (object)
      - `roles` (array) - roles
      - `startDate` (string) - startDate
      - `endDate` (string) - endDate
      - `services` (array) - services
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **POST   /customers/roles/{roleID}/delete** - Remove a role from the current customer

  **Schema Details:**
  **Request Body:**
    **Type**: object
  **Response 200:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `legacyCustomerID` (string) - legacyCustomerID
      - `customerName` (string) - customerName
      - `customerID` (string) - customerID
      - `accessID` (string) - accessID
      - `timezone` (string) - timezone
      - `legacyCustomerEventAreaMask` (number) - legacyCustomerEventAreaMask
      - `legacyCustomerOtherAreaMask` (number) - legacyCustomerOtherAreaMask
      - `legacyECCustomerID` (number) - legacyECCustomerID
      - `contactInfo` (object)
      - `roles` (array) - roles
      - `startDate` (string) - startDate
      - `endDate` (string) - endDate
      - `services` (array) - services
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt


### Customer  Sessions
- **GET    /customerSessions/ping** - Ping customer session

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Properties**:
      - `success` (boolean)
      - `localTTLSecs` (number)
      - `remoteTTLSecs` (number)
      - `remoteTTLRefreshedToSecs` (number)

- **GET    /customerSessions/me** - Get current session data

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Properties**:
      - `sessionID` (string)
      - `providerName` (string)
      - `externalID` (string)
      - `providerUsername` (string)
      - `providerNameFirst` (string)
      - `providerNameLast` (string)
      - `providerData` (object)
      - `updatedAt` (string)
      - `localTTLSecs` (number)
      - `remoteTTLSecs` (number)
      - `lastUpdatedRemoteTTL` (unknown)
  **Response 400:**
    **Type**: object
    **Properties**:
      - `error` (string)
      - `message` (string)

- **GET    /customerSessions/boardsWithAccessForArea** - List boards where session contact has access for area

  **Schema Details:**
  **Response 200:**
    **Type**: object

- **GET    /customerSessions/auth0/loginInfo** - Get Auth0 login information

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Properties**:
      - `auth0LoginURL` (string) - Auth0 login URL to redirect user to
      - `params` (object)

- **POST   /customerSessions/logout** - Logout customer session

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Properties**:
      - `auth0LogoutURL` (string) - Auth0 logout URL to redirect user to
      - `params` (object)

- **GET    /customerSessions/auth0/browserCallback** - Auth0 browser callback

  **Schema Details:**
  **Response 302:**
    **Type**: string
  **Response 401:**
    **Type**: object
    **Properties**:
      - `error` (string)

- **GET    /customerSessions/rateLimitTest** - Rate limit test endpoint

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Properties**:
      - `success` (boolean)
      - `dateTime` (string)


### Customer  Sessions -  Admin
- **GET    /customerSessions/admin/debugInfo** - Get session debug information

  **Schema Details:**
  **Response 200:**
    **Type**: object

- **GET    /customerSessions/admin/allPreLoginStates** - Get all pre-login states

  **Schema Details:**
  **Response 200:**
    **Type**: object


### Backblaze  B2
- **POST   /bb2/eventHook** - Handle B2 webhook events

  **Schema Details:**
  **Response 200:**
    **Type**: string
  **Response 400:**
    **Type**: string
  **Response 401:**
    **Type**: string
  **Response 501:**
    **Type**: string


### Job  Queue
- **POST   /jobQueue/** - Submit a new job to the queue

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Required**: payload, scope, timeoutSeconds
    **Properties**:
      - `payload` (object) (required) - Job-specific data and parameters
      - `scope` (string) (required) - Job scope/type identifier
      - `timeoutSeconds` (number) (required) - Maximum execution time in seconds
      - `fingerprint` (string) - Optional unique identifier for duplicate detection
  **Response 200:**
    **Type**: object
    **Properties**:
      - `jobID` (string) - Unique identifier for the submitted job
  **Response 400:**
    **Type**: object
    **Properties**:
      - `error` (string)
      - `details` (object)

- **GET    /jobQueue/** - Get job information by ID

  **Schema Details:**
  **Response 200:**
    **Type**: object
  **Response 400:**
    **Type**: object
    **Properties**:
      - `error` (string)

- **GET    /jobQueue/completedIDs** - Get completed job IDs

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **GET    /jobQueue/archivedIDs** - Get archived job IDs

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **GET    /jobQueue/stats** - Get Redis queue statistics

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Properties**:
      - `activeJobsCount` (number)
      - `completedJobsCount` (number)
      - `failedJobsCount` (number)

- **GET    /jobQueue/archivedStats** - Get MongoDB archived job statistics

  **Schema Details:**
  **Response 200:**
    **Type**: array
  **Response 500:**
    **Type**: object
    **Properties**:
      - `error` (string)

- **GET    /jobQueue/archived/{status}** - Get archived jobs by status

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Properties**:
      - `jobs` (array)
      - `count` (number)
  **Response 500:**
    **Type**: object
    **Properties**:
      - `error` (string)

- **POST   /jobQueue/cancel** - Cancel a job

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Required**: jobID
    **Properties**:
      - `jobID` (string) (required) - Job identifier to cancel
  **Response 200:**
    **Type**: object
    **Properties**:
      - `isCancelled` (boolean)
  **Response 400:**
    **Type**: object
    **Properties**:
      - `error` (string)
      - `details` (object)

- **POST   /jobQueue/archive** - Archive a job

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Required**: jobID
    **Properties**:
      - `jobID` (string) (required) - Job identifier to archive
  **Response 200:**
    **Type**: object
    **Properties**:
      - `isArchived` (boolean)

- **POST   /jobQueue/delete** - Delete and archive a job to MongoDB

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Required**: jobID
    **Properties**:
      - `jobID` (string) (required) - Job identifier to delete and archive
  **Response 200:**
    **Type**: object
    **Properties**:
      - `insertResult` (object)
      - `deleteResult` (object)
  **Response 400:**
    **Type**: object
    **Properties**:
      - `error` (string)
      - `details` (object)

- **POST   /jobQueue/deleteAll** - Delete and archive all jobs to MongoDB

  **Schema Details:**
  **Response 200:**
    **Type**: array


### Contacts
- **GET    /contacts/** - Get all contacts for a customer

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **GET    /contacts/{id}** - Get a specific contact by ID

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `customerID` (string) - customerID
      - `nameFirst` (string) - nameFirst
      - `nameMiddle` (string) - nameMiddle
      - `nameLast` (string) - nameLast
      - `nameSuffix` (string) - nameSuffix
      - `nickname` (string) - nickname
      - `title` (string) - title
      - `departmentID` (string) - departmentID
      - `tags` (array) - tags
      - `emailPrimary` (string) - emailPrimary
      - `emailsSecondary` (array) - emailsSecondary
      - `emailsPrior` (array) - emailsPrior
      - `addresses` (array) - addresses
      - `phones` (array) - phones
      - `websites` (array) - websites
      - `customFields` (array) - customFields
      - `legacyAdminPermissionMask` (number) - legacyAdminPermissionMask
      - `legacyCredentialEventAreaMask` (number) - legacyCredentialEventAreaMask
      - `legacyCredentialOtherAreaMask` (number) - legacyCredentialOtherAreaMask
      - `legacyDepartment` (string) - legacyDepartment
      - `legacyCredentialStatusID` (number) - legacyCredentialStatusID
      - `notes` (array) - notes
      - `credentials` (array) - credentials
      - `lastLoginAt` (string) - lastLoginAt
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **POST   /contacts/new** - Create a new contact

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `nameFirst` (string) - nameFirst
      - `nameMiddle` (string) - nameMiddle
      - `nameLast` (string) - nameLast
      - `nameSuffix` (string) - nameSuffix
      - `nickname` (string) - nickname
      - `title` (string) - title
      - `departmentID` (string) - departmentID
      - `tags` (array) - tags
      - `emailPrimary` (string) - emailPrimary
      - `emailsSecondary` (array) - emailsSecondary
      - `emailsPrior` (array) - emailsPrior
      - `addresses` (array) - addresses
      - `phones` (array) - phones
      - `websites` (array) - websites
      - `customFields` (array) - customFields
      - `legacyAdminPermissionMask` (number) - legacyAdminPermissionMask
      - `legacyCredentialEventAreaMask` (number) - legacyCredentialEventAreaMask
      - `legacyCredentialOtherAreaMask` (number) - legacyCredentialOtherAreaMask
      - `legacyDepartment` (string) - legacyDepartment
      - `legacyCredentialStatusID` (number) - legacyCredentialStatusID
      - `notes` (array) - notes
      - `credentials` (array) - credentials
      - `lastLoginAt` (string) - lastLoginAt
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt
  **Response 201:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `customerID` (string) - customerID
      - `nameFirst` (string) - nameFirst
      - `nameMiddle` (string) - nameMiddle
      - `nameLast` (string) - nameLast
      - `nameSuffix` (string) - nameSuffix
      - `nickname` (string) - nickname
      - `title` (string) - title
      - `departmentID` (string) - departmentID
      - `tags` (array) - tags
      - `emailPrimary` (string) - emailPrimary
      - `emailsSecondary` (array) - emailsSecondary
      - `emailsPrior` (array) - emailsPrior
      - `addresses` (array) - addresses
      - `phones` (array) - phones
      - `websites` (array) - websites
      - `customFields` (array) - customFields
      - `legacyAdminPermissionMask` (number) - legacyAdminPermissionMask
      - `legacyCredentialEventAreaMask` (number) - legacyCredentialEventAreaMask
      - `legacyCredentialOtherAreaMask` (number) - legacyCredentialOtherAreaMask
      - `legacyDepartment` (string) - legacyDepartment
      - `legacyCredentialStatusID` (number) - legacyCredentialStatusID
      - `notes` (array) - notes
      - `credentials` (array) - credentials
      - `lastLoginAt` (string) - lastLoginAt
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **POST   /contacts/update/{id}** - Update an existing contact

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `nameFirst` (string) - nameFirst
      - `nameMiddle` (string) - nameMiddle
      - `nameLast` (string) - nameLast
      - `nameSuffix` (string) - nameSuffix
      - `nickname` (string) - nickname
      - `title` (string) - title
      - `departmentID` (string) - departmentID
      - `tags` (array) - tags
      - `emailPrimary` (string) - emailPrimary
      - `emailsSecondary` (array) - emailsSecondary
      - `emailsPrior` (array) - emailsPrior
      - `addresses` (array) - addresses
      - `phones` (array) - phones
      - `websites` (array) - websites
      - `customFields` (array) - customFields
      - `legacyAdminPermissionMask` (number) - legacyAdminPermissionMask
      - `legacyCredentialEventAreaMask` (number) - legacyCredentialEventAreaMask
      - `legacyCredentialOtherAreaMask` (number) - legacyCredentialOtherAreaMask
      - `legacyDepartment` (string) - legacyDepartment
      - `legacyCredentialStatusID` (number) - legacyCredentialStatusID
      - `notes` (array) - notes
      - `credentials` (array) - credentials
      - `lastLoginAt` (string) - lastLoginAt
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt
  **Response 200:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `customerID` (string) - customerID
      - `nameFirst` (string) - nameFirst
      - `nameMiddle` (string) - nameMiddle
      - `nameLast` (string) - nameLast
      - `nameSuffix` (string) - nameSuffix
      - `nickname` (string) - nickname
      - `title` (string) - title
      - `departmentID` (string) - departmentID
      - `tags` (array) - tags
      - `emailPrimary` (string) - emailPrimary
      - `emailsSecondary` (array) - emailsSecondary
      - `emailsPrior` (array) - emailsPrior
      - `addresses` (array) - addresses
      - `phones` (array) - phones
      - `websites` (array) - websites
      - `customFields` (array) - customFields
      - `legacyAdminPermissionMask` (number) - legacyAdminPermissionMask
      - `legacyCredentialEventAreaMask` (number) - legacyCredentialEventAreaMask
      - `legacyCredentialOtherAreaMask` (number) - legacyCredentialOtherAreaMask
      - `legacyDepartment` (string) - legacyDepartment
      - `legacyCredentialStatusID` (number) - legacyCredentialStatusID
      - `notes` (array) - notes
      - `credentials` (array) - credentials
      - `lastLoginAt` (string) - lastLoginAt
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **POST   /contacts/markDeleted/{id}** - Mark contact as deleted (soft delete)

  **Schema Details:**
  **Request Body:**
    **Type**: object
  **Response 200:**
    **Type**: object
    **Required**: modifiedCount, acknowledged
    **Properties**:
      - `modifiedCount` (number) (required) - Number of documents modified
      - `acknowledged` (boolean) (required) - Whether the operation was acknowledged

- **POST   /contacts/reallyDelete/{id}** - Permanently delete contact (hard delete)

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Required**: deletedCount, acknowledged
    **Properties**:
      - `deletedCount` (number) (required) - Number of documents deleted
      - `acknowledged` (boolean) (required) - Whether the operation was acknowledged


### Contact  Credentials
- **GET    /contacts/{id}/activeCredentials** - Get all credentials for a contact

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **GET    /contacts/{id}/credentials/{credentialId}** - Get a specific credential by index

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Required**: type, value
    **Properties**:
      - `type` (string) (required) - type
      - `areaKey` (string) - areaKey
      - `value` (string) (required) - value
      - `scopeType` (string) - scopeType
      - `scopeValues` (array) - scopeValues
      - `expiresAt` (string) - expiresAt
      - `deletedAt` (string) - deletedAt

- **POST   /contacts/{id}/credentials/new** - Add a new credential to a contact

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Required**: type, value
    **Properties**:
      - `type` (string) (required) - type
      - `areaKey` (string) - areaKey
      - `value` (string) (required) - value
      - `scopeType` (string) - scopeType
      - `scopeValues` (array) - scopeValues
      - `expiresAt` (string) - expiresAt
      - `deletedAt` (string) - deletedAt
  **Response 201:**
    **Type**: object
    **Required**: type, value
    **Properties**:
      - `type` (string) (required) - type
      - `areaKey` (string) - areaKey
      - `value` (string) (required) - value
      - `scopeType` (string) - scopeType
      - `scopeValues` (array) - scopeValues
      - `expiresAt` (string) - expiresAt
      - `deletedAt` (string) - deletedAt

- **POST   /contacts/{id}/credentials/{credentialId}/update** - Update a specific credential

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Required**: type, value
    **Properties**:
      - `type` (string) (required) - type
      - `areaKey` (string) - areaKey
      - `value` (string) (required) - value
      - `scopeType` (string) - scopeType
      - `scopeValues` (array) - scopeValues
      - `expiresAt` (string) - expiresAt
      - `deletedAt` (string) - deletedAt
  **Response 200:**
    **Type**: object
    **Required**: type, value
    **Properties**:
      - `type` (string) (required) - type
      - `areaKey` (string) - areaKey
      - `value` (string) (required) - value
      - `scopeType` (string) - scopeType
      - `scopeValues` (array) - scopeValues
      - `expiresAt` (string) - expiresAt
      - `deletedAt` (string) - deletedAt

- **POST   /contacts/{id}/credentials/{credentialId}/delete** - Delete credential

  **Schema Details:**
  **Request Body:**
    **Type**: object
  **Response 200:**
    **Type**: object
    **Required**: deletedCount, acknowledged
    **Properties**:
      - `deletedCount` (number) (required) - Number of documents deleted
      - `acknowledged` (boolean) (required) - Whether the operation was acknowledged


### Organization  Units
- **GET    /organizationUnits/** - Get all organization units for a customer

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **GET    /organizationUnits/{id}** - Get a specific organization unit by ID

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `customerID` (string) - customerID
      - `name` (string) - name
      - `description` (string) - description
      - `nickname` (string) - nickname
      - `type` (string) - type
      - `level` (number) - level
      - `parentID` (string) - parentID
      - `subLevels` (array) - subLevels
      - `rules` (array) - rules
      - `eventTypes` (array) - eventTypes
      - `deletedAt` (string) - deletedAt
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **POST   /organizationUnits/new** - Create a new organization unit

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Required**: name, type
    **Properties**:
      - `_id` (string) - _id
      - `name` (string) (required) - name
      - `description` (string) - description
      - `nickname` (string) - nickname
      - `type` (string) (required) - type
      - `level` (number) - level
      - `parentID` (string) - parentID
      - `subLevels` (array) - subLevels
      - `rules` (array) - rules
      - `eventTypes` (array) - eventTypes
      - `deletedAt` (string) - deletedAt
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt
  **Response 201:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `customerID` (string) - customerID
      - `name` (string) - name
      - `description` (string) - description
      - `nickname` (string) - nickname
      - `type` (string) - type
      - `level` (number) - level
      - `parentID` (string) - parentID
      - `subLevels` (array) - subLevels
      - `rules` (array) - rules
      - `eventTypes` (array) - eventTypes
      - `deletedAt` (string) - deletedAt
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **POST   /organizationUnits/update/{id}** - Update an existing organization unit

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Properties**:
      - `name` (string) - name
      - `description` (string) - description
      - `nickname` (string) - nickname
      - `type` (string) - type
      - `level` (number) - level
      - `parentID` (string) - parentID
      - `rules` (array) - rules
      - `deletedAt` (string) - deletedAt
  **Response 200:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `customerID` (string) - customerID
      - `name` (string) - name
      - `description` (string) - description
      - `nickname` (string) - nickname
      - `type` (string) - type
      - `level` (number) - level
      - `parentID` (string) - parentID
      - `subLevels` (array) - subLevels
      - `rules` (array) - rules
      - `eventTypes` (array) - eventTypes
      - `deletedAt` (string) - deletedAt
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **POST   /organizationUnits/markDeleted/{id}** - Mark organization unit as deleted (soft delete)

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Required**: modifiedCount, acknowledged
    **Properties**:
      - `modifiedCount` (number) (required) - Number of documents modified
      - `acknowledged` (boolean) (required) - Whether the operation was acknowledged

- **GET    /organizationUnits/byContact/{contactID}** - Get organization units by contact

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **GET    /organizationUnits/byType/{type}** - Get organization units by type

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **GET    /organizationUnits/hierarchy/{id}** - Get organization unit hierarchy

  **Schema Details:**
  **Response 200:**
    **Type**: array


### Organization  Units -  Sub Levels
- **GET    /organizationUnits/{id}/subLevels** - Get all sub-levels for an organization unit

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **POST   /organizationUnits/{id}/subLevels/new** - Create a new sub-level

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Required**: name, levelOrdinal
    **Properties**:
      - `name` (string) (required) - Level name
      - `levelOrdinal` (number) (required) - Numeric ordinal for the level
  **Response 201:**
    **Type**: object
    **Required**: name, levelOrdinal
    **Properties**:
      - `_id` (string) - _id
      - `name` (string) (required) - name
      - `deletedAt` (string) - deletedAt
      - `levelOrdinal` (number) (required) - levelOrdinal

- **POST   /organizationUnits/{id}/subLevels/{levelID}/update** - Update a sub-level

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Properties**:
      - `name` (string)
      - `levelOrdinal` (number)
  **Response 200:**
    **Type**: object
    **Required**: name, levelOrdinal
    **Properties**:
      - `_id` (string) - _id
      - `name` (string) (required) - name
      - `deletedAt` (string) - deletedAt
      - `levelOrdinal` (number) (required) - levelOrdinal

- **POST   /organizationUnits/{id}/subLevels/{levelID}/markDeleted** - Soft delete a sub-level

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Required**: isDeleted
    **Properties**:
      - `isDeleted` (boolean) (required) - true to mark deleted, false to restore
  **Response 200:**
    **Type**: object
    **Required**: modifiedCount, acknowledged
    **Properties**:
      - `modifiedCount` (number) (required) - Number of documents modified
      - `acknowledged` (boolean) (required) - Whether the operation was acknowledged


### Organization  Units -  Event Types
- **GET    /organizationUnits/{id}/eventTypes** - Get all event types for an organization unit

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **GET    /organizationUnits/{id}/activeEventTypes** - Get active event types for an organization unit

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **POST   /organizationUnits/{id}/eventTypes/new** - Create a new event type

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Required**: name
    **Properties**:
      - `name` (string) (required) - Event type name
  **Response 201:**
    **Type**: object
    **Required**: name
    **Properties**:
      - `_id` (string) - _id
      - `name` (string) (required) - name
      - `deletedAt` (string) - deletedAt

- **POST   /organizationUnits/{id}/eventTypes/{eventTypeID}/update** - Update an event type

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Properties**:
      - `name` (string)
  **Response 200:**
    **Type**: object
    **Required**: name
    **Properties**:
      - `_id` (string) - _id
      - `name` (string) (required) - name
      - `deletedAt` (string) - deletedAt

- **POST   /organizationUnits/{id}/eventTypes/{eventTypeID}/markDeleted** - Soft delete an event type

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Properties**:
      - `isDeleted` (boolean) - true to mark deleted, false to restore
  **Response 200:**
    **Type**: object
    **Required**: modifiedCount, acknowledged
    **Properties**:
      - `modifiedCount` (number) (required) - Number of documents modified
      - `acknowledged` (boolean) (required) - Whether the operation was acknowledged


### Organization  Unit  Seats
- **GET    /organizationUnitSeats/** - Get all organization unit seats

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **GET    /organizationUnitSeats/byOrganizationUnit/{organizationUnitID}** - Get seats by organization unit

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **GET    /organizationUnitSeats/byContact/{contactID}** - Get seats by contact

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **GET    /organizationUnitSeats/organizationUnitIDsByContact/{contactID}** - Get organizationUnitIDs by contact

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **POST   /organizationUnitSeats/new** - Create a new organization unit seat

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Required**: organizationUnitID, contactID, levelID
    **Properties**:
      - `organizationUnitID` (string) (required) - organizationUnitID
      - `contactID` (string) (required) - contactID
      - `levelID` (string) (required) - levelID
      - `name` (string) - name
      - `validStartAt` (string) - validStartAt
      - `validEndAt` (string) - validEndAt
      - `isActive` (boolean) - isActive
      - `flags` (array) - flags
      - `deletedAt` (string) - deletedAt
  **Response 201:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `customerID` (string) - customerID
      - `organizationUnitID` (string) - organizationUnitID
      - `contactID` (string) - contactID
      - `levelID` (string) - levelID
      - `name` (string) - name
      - `validStartAt` (string) - validStartAt
      - `validEndAt` (string) - validEndAt
      - `isActive` (boolean) - isActive
      - `flags` (array) - flags
      - `deletedAt` (string) - deletedAt
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **POST   /organizationUnitSeats/update/{id}** - Update an organization unit seat

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Properties**:
      - `organizationUnitID` (string) - organizationUnitID
      - `contactID` (string) - contactID
      - `levelID` (string) - levelID
      - `name` (string) - name
      - `validStartAt` (string) - validStartAt
      - `validEndAt` (string) - validEndAt
      - `isActive` (boolean) - isActive
      - `flags` (array) - flags
      - `deletedAt` (string) - deletedAt
  **Response 200:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `customerID` (string) - customerID
      - `organizationUnitID` (string) - organizationUnitID
      - `contactID` (string) - contactID
      - `levelID` (string) - levelID
      - `name` (string) - name
      - `validStartAt` (string) - validStartAt
      - `validEndAt` (string) - validEndAt
      - `isActive` (boolean) - isActive
      - `flags` (array) - flags
      - `deletedAt` (string) - deletedAt
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **POST   /organizationUnitSeats/markDeleted/{id}** - Mark organization unit seat as deleted

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Required**: modifiedCount, acknowledged
    **Properties**:
      - `modifiedCount` (number) (required) - Number of documents modified
      - `acknowledged` (boolean) (required) - Whether the operation was acknowledged

- **POST   /organizationUnitSeats/markUndeleted/{id}** - Restore organization unit seat

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `customerID` (string) - customerID
      - `organizationUnitID` (string) - organizationUnitID
      - `contactID` (string) - contactID
      - `levelID` (string) - levelID
      - `name` (string) - name
      - `validStartAt` (string) - validStartAt
      - `validEndAt` (string) - validEndAt
      - `isActive` (boolean) - isActive
      - `flags` (array) - flags
      - `deletedAt` (string) - deletedAt
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt


### Global  Config
- **GET    /globalConfig/all** - Get all global configuration entries

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **GET    /globalConfig/{key}** - Get global configuration by key

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Properties**:
      - `_id` (string)
      - `key` (string)
      - `value` (unknown)
      - `createdAt` (string)
      - `updatedAt` (string)


### Media
- **GET    /media/** - Get media entries for a customer

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **GET    /media/active** - Get active media entries for a customer

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **GET    /media/all** - Get all media entries (including deleted)

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **GET    /media/byArea/{areaClass}/{areaTargetID}** - Get active media by area

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **GET    /media/all/byArea/{areaClass}/{areaTargetID}** - Get all media by area (including deleted)

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **GET    /media/byBelongsTo/{belongsToClass}/{belongsToTargetID}** - Get active media by belongsTo

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **GET    /media/all/byBelongsTo/{belongsToClass}/{belongsToTargetID}** - Get all media by belongsTo (including deleted)

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **GET    /media/{id}** - Get a media entry by ID

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `customerID` (string) - customerID
      - `legacyCustomerMediaID` (number) - legacyCustomerMediaID
      - `copyOfLegacyCustomerMediaID` (number) - copyOfLegacyCustomerMediaID
      - `legacyCustomerApplicationID` (number) - legacyCustomerApplicationID
      - `legacyCustomerEventID` (number) - legacyCustomerEventID
      - `legacyMediaClassID` (number) - legacyMediaClassID
      - `legacyMediaTypeID` (number) - legacyMediaTypeID
      - `legacyCustomerEncoderID` (number) - legacyCustomerEncoderID
      - `legacyMediaFeatureMask` (number) - legacyMediaFeatureMask
      - `legacyCustomerSyncedAt` (string) - legacyCustomerSyncedAt
      - `legacyServerSyncedAt` (string) - legacyServerSyncedAt
      - `legacyOrderOrdinal` (number) - legacyOrderOrdinal
      - `areaClass` (string) - areaClass
      - `areaTargetID` (string) - areaTargetID
      - `belongsToClass` (string) - belongsToClass
      - `belongsToTargetID` (string) - belongsToTargetID
      - `nickName` (string) - nickName
      - `externalID` (string) - externalID
      - `orderID` (string) - orderID
      - `currentVersion` (object)
      - `previousVersions` (array) - previousVersions
      - `deletedAt` (string) - deletedAt
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **POST   /media/new** - Create a new media entry

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Required**: currentVersion
    **Properties**:
      - `areaClass` (string)
      - `areaTargetID` (string)
      - `belongsToClass` (string)
      - `belongsToTargetID` (string)
      - `nickName` (string)
      - `externalID` (string)
      - `currentVersion` (object) (required)
  **Response 201:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `customerID` (string) - customerID
      - `legacyCustomerMediaID` (number) - legacyCustomerMediaID
      - `copyOfLegacyCustomerMediaID` (number) - copyOfLegacyCustomerMediaID
      - `legacyCustomerApplicationID` (number) - legacyCustomerApplicationID
      - `legacyCustomerEventID` (number) - legacyCustomerEventID
      - `legacyMediaClassID` (number) - legacyMediaClassID
      - `legacyMediaTypeID` (number) - legacyMediaTypeID
      - `legacyCustomerEncoderID` (number) - legacyCustomerEncoderID
      - `legacyMediaFeatureMask` (number) - legacyMediaFeatureMask
      - `legacyCustomerSyncedAt` (string) - legacyCustomerSyncedAt
      - `legacyServerSyncedAt` (string) - legacyServerSyncedAt
      - `legacyOrderOrdinal` (number) - legacyOrderOrdinal
      - `areaClass` (string) - areaClass
      - `areaTargetID` (string) - areaTargetID
      - `belongsToClass` (string) - belongsToClass
      - `belongsToTargetID` (string) - belongsToTargetID
      - `nickName` (string) - nickName
      - `externalID` (string) - externalID
      - `orderID` (string) - orderID
      - `currentVersion` (object)
      - `previousVersions` (array) - previousVersions
      - `deletedAt` (string) - deletedAt
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **POST   /media/update/{id}** - Update media metadata

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Properties**:
      - `areaClass` (string)
      - `areaTargetID` (string)
      - `belongsToClass` (string)
      - `belongsToTargetID` (string)
      - `nickName` (string)
      - `externalID` (string)
  **Response 200:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `customerID` (string) - customerID
      - `legacyCustomerMediaID` (number) - legacyCustomerMediaID
      - `copyOfLegacyCustomerMediaID` (number) - copyOfLegacyCustomerMediaID
      - `legacyCustomerApplicationID` (number) - legacyCustomerApplicationID
      - `legacyCustomerEventID` (number) - legacyCustomerEventID
      - `legacyMediaClassID` (number) - legacyMediaClassID
      - `legacyMediaTypeID` (number) - legacyMediaTypeID
      - `legacyCustomerEncoderID` (number) - legacyCustomerEncoderID
      - `legacyMediaFeatureMask` (number) - legacyMediaFeatureMask
      - `legacyCustomerSyncedAt` (string) - legacyCustomerSyncedAt
      - `legacyServerSyncedAt` (string) - legacyServerSyncedAt
      - `legacyOrderOrdinal` (number) - legacyOrderOrdinal
      - `areaClass` (string) - areaClass
      - `areaTargetID` (string) - areaTargetID
      - `belongsToClass` (string) - belongsToClass
      - `belongsToTargetID` (string) - belongsToTargetID
      - `nickName` (string) - nickName
      - `externalID` (string) - externalID
      - `orderID` (string) - orderID
      - `currentVersion` (object)
      - `previousVersions` (array) - previousVersions
      - `deletedAt` (string) - deletedAt
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **POST   /media/{id}/publishNewVersion** - Publish a new media version

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Required**: newVersion
    **Properties**:
      - `newVersion` (object) (required)
  **Response 200:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `customerID` (string) - customerID
      - `legacyCustomerMediaID` (number) - legacyCustomerMediaID
      - `copyOfLegacyCustomerMediaID` (number) - copyOfLegacyCustomerMediaID
      - `legacyCustomerApplicationID` (number) - legacyCustomerApplicationID
      - `legacyCustomerEventID` (number) - legacyCustomerEventID
      - `legacyMediaClassID` (number) - legacyMediaClassID
      - `legacyMediaTypeID` (number) - legacyMediaTypeID
      - `legacyCustomerEncoderID` (number) - legacyCustomerEncoderID
      - `legacyMediaFeatureMask` (number) - legacyMediaFeatureMask
      - `legacyCustomerSyncedAt` (string) - legacyCustomerSyncedAt
      - `legacyServerSyncedAt` (string) - legacyServerSyncedAt
      - `legacyOrderOrdinal` (number) - legacyOrderOrdinal
      - `areaClass` (string) - areaClass
      - `areaTargetID` (string) - areaTargetID
      - `belongsToClass` (string) - belongsToClass
      - `belongsToTargetID` (string) - belongsToTargetID
      - `nickName` (string) - nickName
      - `externalID` (string) - externalID
      - `orderID` (string) - orderID
      - `currentVersion` (object)
      - `previousVersions` (array) - previousVersions
      - `deletedAt` (string) - deletedAt
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **POST   /media/{id}/restoreVersion** - Restore a previous version as current

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Required**: versionID
    **Properties**:
      - `versionID` (string) (required)
  **Response 200:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `customerID` (string) - customerID
      - `legacyCustomerMediaID` (number) - legacyCustomerMediaID
      - `copyOfLegacyCustomerMediaID` (number) - copyOfLegacyCustomerMediaID
      - `legacyCustomerApplicationID` (number) - legacyCustomerApplicationID
      - `legacyCustomerEventID` (number) - legacyCustomerEventID
      - `legacyMediaClassID` (number) - legacyMediaClassID
      - `legacyMediaTypeID` (number) - legacyMediaTypeID
      - `legacyCustomerEncoderID` (number) - legacyCustomerEncoderID
      - `legacyMediaFeatureMask` (number) - legacyMediaFeatureMask
      - `legacyCustomerSyncedAt` (string) - legacyCustomerSyncedAt
      - `legacyServerSyncedAt` (string) - legacyServerSyncedAt
      - `legacyOrderOrdinal` (number) - legacyOrderOrdinal
      - `areaClass` (string) - areaClass
      - `areaTargetID` (string) - areaTargetID
      - `belongsToClass` (string) - belongsToClass
      - `belongsToTargetID` (string) - belongsToTargetID
      - `nickName` (string) - nickName
      - `externalID` (string) - externalID
      - `orderID` (string) - orderID
      - `currentVersion` (object)
      - `previousVersions` (array) - previousVersions
      - `deletedAt` (string) - deletedAt
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **POST   /media/markDeleted/{id}** - Mark media as deleted (soft delete)

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Required**: modifiedCount, acknowledged
    **Properties**:
      - `modifiedCount` (number) (required) - Number of documents modified
      - `acknowledged` (boolean) (required) - Whether the operation was acknowledged

- **POST   /media/markUndeleted/{id}** - Restore media (undo soft delete)

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Required**: modifiedCount, acknowledged
    **Properties**:
      - `modifiedCount` (number) (required) - Number of documents modified
      - `acknowledged` (boolean) (required) - Whether the operation was acknowledged

- **POST   /media/upload/initiate** - Initiate chunked upload session

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Required**: fileName, fileSize, areaClass, areaTargetID, belongsToClass, belongsToTargetID
    **Properties**:
      - `fileName` (string) (required) - Original file name
      - `fileSize` (integer) (required) - Total file size in bytes
      - `areaClass` (string) (required)
      - `areaTargetID` (string) (required)
      - `belongsToClass` (string) (required)
      - `belongsToTargetID` (string) (required)
      - `nickName` (string) - Optional nickname
  **Response 201:**
    **Type**: object
    **Properties**:
      - `sessionId` (string)
      - `chunkSize` (integer)
      - `totalChunks` (integer)

- **POST   /media/upload/chunk** - Upload individual chunk

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Required**: sessionId, chunkNumber, chunkData
    **Properties**:
      - `sessionId` (string) (required)
      - `chunkNumber` (integer) (required)
      - `chunkData` (string) (required) - Base64 encoded chunk data
  **Response 200:**
    **Type**: object
    **Properties**:
      - `chunkNumber` (integer)
      - `uploadedChunks` (integer)
      - `totalChunks` (integer)
      - `isComplete` (boolean)

- **POST   /media/upload/finalize/{sessionId}** - Finalize chunked upload

  **Schema Details:**
  **Response 201:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `customerID` (string) - customerID
      - `legacyCustomerMediaID` (number) - legacyCustomerMediaID
      - `copyOfLegacyCustomerMediaID` (number) - copyOfLegacyCustomerMediaID
      - `legacyCustomerApplicationID` (number) - legacyCustomerApplicationID
      - `legacyCustomerEventID` (number) - legacyCustomerEventID
      - `legacyMediaClassID` (number) - legacyMediaClassID
      - `legacyMediaTypeID` (number) - legacyMediaTypeID
      - `legacyCustomerEncoderID` (number) - legacyCustomerEncoderID
      - `legacyMediaFeatureMask` (number) - legacyMediaFeatureMask
      - `legacyCustomerSyncedAt` (string) - legacyCustomerSyncedAt
      - `legacyServerSyncedAt` (string) - legacyServerSyncedAt
      - `legacyOrderOrdinal` (number) - legacyOrderOrdinal
      - `areaClass` (string) - areaClass
      - `areaTargetID` (string) - areaTargetID
      - `belongsToClass` (string) - belongsToClass
      - `belongsToTargetID` (string) - belongsToTargetID
      - `nickName` (string) - nickName
      - `externalID` (string) - externalID
      - `orderID` (string) - orderID
      - `currentVersion` (object)
      - `previousVersions` (array) - previousVersions
      - `deletedAt` (string) - deletedAt
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **POST   /media/upload/abort/{sessionId}** - Abort chunked upload session

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Required**: modifiedCount, acknowledged
    **Properties**:
      - `modifiedCount` (number) (required) - Number of documents modified
      - `acknowledged` (boolean) (required) - Whether the operation was acknowledged

- **POST   /media/reallyDelete/{id}** - Permanently delete media (hard delete)

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Required**: deletedCount, acknowledged
    **Properties**:
      - `deletedCount` (number) (required) - Number of documents deleted
      - `acknowledged` (boolean) (required) - Whether the operation was acknowledged

- **GET    /media/download/{id}** - Download media file

  **Schema Details:**
  **Response 200:**
    **Type**: string

- **GET    /media/_internal/proxy/{id}/{versionID}** - Internal: proxy to S3 for media streaming

  **Schema Details:**
  **Response 200:**
    **Type**: string


### Other
- **GET    /staticDocs/** - No description

- **GET    /staticDocs/{page}** - No description


### Static  Auth
- **POST   /downstreamAuth/verifyStatic** - Verify cdsBearerAuthStatic access for a path

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Required**: url, apiKey, method, appNameAndReleaseMode
    **Properties**:
      - `url` (string) (required) - Path-only URL beginning with / (e.g., /v1/boards/...)
      - `apiKey` (string) (required) - Static bearer in format APP.MODE:USER:UUID
      - `method` (string) (required) - HTTP method
      - `appNameAndReleaseMode` (string) (required) - Downstream appName.releaseMode to validate against
  **Response 200:**
    **Type**: object
    **Properties**:
      - `result` (string)


### Customer  Auth
- **POST   /downstreamAuth/verifyCustomer** - Verify customer session by sessionID

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Required**: url, cookies, method, appNameAndReleaseMode
    **Properties**:
      - `url` (string) (required) - Path-only URL beginning with / (e.g., /v1/boards/...)
      - `cookies` (object) (required) - Cookies object from the downstream browser request
      - `method` (string) (required) - HTTP method
      - `appNameAndReleaseMode` (string) (required) - Downstream appName.releaseMode to validate against
  **Response 200:**
    **Type**: object
    **Properties**:
      - `sessionInfo` (string)


### Data  Units
- **GET    /dataUnits/** - List data units (all)

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **GET    /dataUnits/active** - List active data units

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **GET    /dataUnits/{id}** - Get a data unit by ID

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `customerID` (string) - customerID
      - `scopeArea` (string) - scopeArea
      - `scopeClass` (string) - scopeClass
      - `scopeID` (unknown) - scopeID
      - `orderID` (unknown) - orderID
      - `parentID` (string) - parentID
      - `value` (unknown) - value
      - `dateStart` (string) - dateStart
      - `dateEnd` (string) - dateEnd
      - `deletedAt` (string) - deletedAt
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **POST   /dataUnits/new** - Create a new data unit

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Required**: scopeArea, scopeClass
    **Properties**:
      - `scopeArea` (string) (required) - scopeArea
      - `scopeClass` (string) (required) - scopeClass
      - `scopeID` (unknown) - scopeID
      - `orderID` (unknown) - orderID
      - `parentID` (unknown) - parentID
      - `value` (unknown) - value
      - `dateStart` (unknown) - dateStart
      - `dateEnd` (unknown) - dateEnd
      - `deletedAt` (string) - deletedAt
  **Response 201:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `customerID` (string) - customerID
      - `scopeArea` (string) - scopeArea
      - `scopeClass` (string) - scopeClass
      - `scopeID` (unknown) - scopeID
      - `orderID` (unknown) - orderID
      - `parentID` (string) - parentID
      - `value` (unknown) - value
      - `dateStart` (string) - dateStart
      - `dateEnd` (string) - dateEnd
      - `deletedAt` (string) - deletedAt
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **POST   /dataUnits/update/{id}** - Update a data unit

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Properties**:
      - `scopeArea` (string) - scopeArea
      - `scopeClass` (string) - scopeClass
      - `scopeID` (unknown) - scopeID
      - `orderID` (unknown) - orderID
      - `parentID` (unknown) - parentID
      - `value` (unknown) - value
      - `dateStart` (unknown) - dateStart
      - `dateEnd` (unknown) - dateEnd
  **Response 200:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `customerID` (string) - customerID
      - `scopeArea` (string) - scopeArea
      - `scopeClass` (string) - scopeClass
      - `scopeID` (unknown) - scopeID
      - `orderID` (unknown) - orderID
      - `parentID` (string) - parentID
      - `value` (unknown) - value
      - `dateStart` (string) - dateStart
      - `dateEnd` (string) - dateEnd
      - `deletedAt` (string) - deletedAt
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **POST   /dataUnits/markDeleted/{id}** - Soft delete a data unit

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Required**: modifiedCount, acknowledged
    **Properties**:
      - `modifiedCount` (number) (required) - Number of documents modified
      - `acknowledged` (boolean) (required) - Whether the operation was acknowledged

- **POST   /dataUnits/markUndeleted/{id}** - Restore a soft-deleted data unit

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Required**: modifiedCount, acknowledged
    **Properties**:
      - `modifiedCount` (number) (required) - Number of documents modified
      - `acknowledged` (boolean) (required) - Whether the operation was acknowledged

- **POST   /dataUnits/{id}/setOrderID** - Set orderID using fractional indexing

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Properties**:
      - `beforeOrderID` (unknown)
      - `afterOrderID` (unknown)
  **Response 200:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `customerID` (string) - customerID
      - `scopeArea` (string) - scopeArea
      - `scopeClass` (string) - scopeClass
      - `scopeID` (unknown) - scopeID
      - `orderID` (unknown) - orderID
      - `parentID` (string) - parentID
      - `value` (unknown) - value
      - `dateStart` (string) - dateStart
      - `dateEnd` (string) - dateEnd
      - `deletedAt` (string) - deletedAt
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt


### Scoped  Counters -  Admin
- **POST   /scopedCounters/admin/new** - Create a new scoped counter

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Required**: customerID, scope
    **Properties**:
      - `customerID` (string) (required) - Tenant/customer identifier
      - `scope` (string) (required) - Counter scope key (unique per customer)
      - `resetPolicy` (string) - Reset policy (default NEVER)
      - `resetRolloverDayOfYear` (number) - YEARLY rollover day-of-year (1..366)
      - `resetRolloverDayOfMonth` (number) - MONTHLY rollover day-of-month (1..31)
      - `resetTimezone` (string) - IANA timezone (e.g., UTC, America/New_York)
      - `initialCounter` (number) - Initial counter value (default 0)
  **Response 201:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `customerID` (string) - customerID
      - `scope` (string) - scope
      - `resetPolicy` (string) - resetPolicy
      - `resetRolloverDayOfYear` (number) - resetRolloverDayOfYear
      - `resetRolloverDayOfMonth` (number) - resetRolloverDayOfMonth
      - `resetTimezone` (string) - resetTimezone
      - `currentPeriodKey` (string) - currentPeriodKey
      - `currentCounter` (number) - currentCounter
      - `lastIncrement` (object)
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **POST   /scopedCounters/admin/{counterID}/update** - Update scoped counter configuration

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Properties**:
      - `resetPolicy` (string) - Reset policy
      - `resetRolloverDayOfYear` (number) - YEARLY rollover day-of-year (1..366)
      - `resetRolloverDayOfMonth` (number) - MONTHLY rollover day-of-month (1..31)
      - `resetTimezone` (string) - IANA timezone (e.g., UTC, America/New_York)
  **Response 200:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `customerID` (string) - customerID
      - `scope` (string) - scope
      - `resetPolicy` (string) - resetPolicy
      - `resetRolloverDayOfYear` (number) - resetRolloverDayOfYear
      - `resetRolloverDayOfMonth` (number) - resetRolloverDayOfMonth
      - `resetTimezone` (string) - resetTimezone
      - `currentPeriodKey` (string) - currentPeriodKey
      - `currentCounter` (number) - currentCounter
      - `lastIncrement` (object)
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **GET    /scopedCounters/admin/{counterID}** - Get scoped counter

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `customerID` (string) - customerID
      - `scope` (string) - scope
      - `resetPolicy` (string) - resetPolicy
      - `resetRolloverDayOfYear` (number) - resetRolloverDayOfYear
      - `resetRolloverDayOfMonth` (number) - resetRolloverDayOfMonth
      - `resetTimezone` (string) - resetTimezone
      - `currentPeriodKey` (string) - currentPeriodKey
      - `currentCounter` (number) - currentCounter
      - `lastIncrement` (object)
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **GET    /scopedCounters/admin/** - List scoped counters

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **POST   /scopedCounters/admin/{counterID}/advance** - Advance scoped counter (skip values)

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Properties**:
      - `advanceTo` (number) - Advance counter to at least this value (no decrease)
      - `advanceBy` (number) - Advance counter forward by N
      - `reason` (string) - Audit reason (recommended)
      - `idempotencyKey` (string) - Optional idempotency key for advance
  **Response 200:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `customerID` (string) - customerID
      - `scope` (string) - scope
      - `resetPolicy` (string) - resetPolicy
      - `resetRolloverDayOfYear` (number) - resetRolloverDayOfYear
      - `resetRolloverDayOfMonth` (number) - resetRolloverDayOfMonth
      - `resetTimezone` (string) - resetTimezone
      - `currentPeriodKey` (string) - currentPeriodKey
      - `currentCounter` (number) - currentCounter
      - `lastIncrement` (object)
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt


### Scoped  Counters
- **GET    /scopedCounters/byScope/{scope}** - Get scoped counter by scope

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `customerID` (string) - customerID
      - `scope` (string) - scope
      - `resetPolicy` (string) - resetPolicy
      - `resetRolloverDayOfYear` (number) - resetRolloverDayOfYear
      - `resetRolloverDayOfMonth` (number) - resetRolloverDayOfMonth
      - `resetTimezone` (string) - resetTimezone
      - `currentPeriodKey` (string) - currentPeriodKey
      - `currentCounter` (number) - currentCounter
      - `lastIncrement` (object)
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **GET    /scopedCounters/scopes** - List all scoped counter scopes

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **POST   /scopedCounters/increment** - Increment scoped counter (idempotent)

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Required**: scope, idempotencyKey, claimTarget
    **Properties**:
      - `scope` (string) (required) - Counter scope key
      - `idempotencyKey` (string) (required) - Caller-supplied idempotency key
      - `claimTarget` (object) (required)
  **Response 200:**
    **Type**: object
    **Properties**:
      - `at` (string)
      - `currentCounter` (number)
      - `currentPeriodKey` (null,string)


### Transcripts
- **GET    /transcripts/** - List all transcripts (paginated)

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **GET    /transcripts/active** - List active transcripts (paginated)

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **GET    /transcripts/{transcriptID}** - Get a transcript by ID

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `customerID` (string) - customerID
      - `mediaID` (string) - mediaID
      - `fullText` (string) - fullText
      - `status` (string) - status
      - `externalMediaID` (string) - externalMediaID
      - `providerName` (string) - providerName
      - `providerJobID` (string) - providerJobID
      - `providerMeta` (unknown) - providerMeta
      - `silenceAnalysis` (unknown) - silenceAnalysis
      - `textOriginal` (string) - textOriginal
      - `textOriginalSource` (string) - textOriginalSource
      - `textModified` (string) - textModified
      - `deletedAt` (string) - deletedAt
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **POST   /transcripts/new** - Create a new transcript

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Required**: status
    **Properties**:
      - `mediaID` (string) - mediaID
      - `fullText` (string) - fullText
      - `status` (string) (required) - status
      - `externalMediaID` (string) - externalMediaID
      - `providerName` (string) - providerName
      - `providerJobID` (string) - providerJobID
      - `providerMeta` (unknown) - providerMeta
      - `silenceAnalysis` (unknown) - silenceAnalysis
      - `textOriginal` (string) - textOriginal
      - `textOriginalSource` (string) - textOriginalSource
      - `textModified` (string) - textModified
  **Response 201:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `customerID` (string) - customerID
      - `mediaID` (string) - mediaID
      - `fullText` (string) - fullText
      - `status` (string) - status
      - `externalMediaID` (string) - externalMediaID
      - `providerName` (string) - providerName
      - `providerJobID` (string) - providerJobID
      - `providerMeta` (unknown) - providerMeta
      - `silenceAnalysis` (unknown) - silenceAnalysis
      - `textOriginal` (string) - textOriginal
      - `textOriginalSource` (string) - textOriginalSource
      - `textModified` (string) - textModified
      - `deletedAt` (string) - deletedAt
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **POST   /transcripts/{transcriptID}/update** - Update a transcript

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Properties**:
      - `mediaID` (string) - mediaID
      - `fullText` (string) - fullText
      - `status` (string) - status
      - `externalMediaID` (string) - externalMediaID
      - `providerName` (string) - providerName
      - `providerJobID` (string) - providerJobID
      - `providerMeta` (unknown) - providerMeta
      - `silenceAnalysis` (unknown) - silenceAnalysis
      - `textOriginal` (string) - textOriginal
      - `textOriginalSource` (string) - textOriginalSource
      - `textModified` (string) - textModified
  **Response 200:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `customerID` (string) - customerID
      - `mediaID` (string) - mediaID
      - `fullText` (string) - fullText
      - `status` (string) - status
      - `externalMediaID` (string) - externalMediaID
      - `providerName` (string) - providerName
      - `providerJobID` (string) - providerJobID
      - `providerMeta` (unknown) - providerMeta
      - `silenceAnalysis` (unknown) - silenceAnalysis
      - `textOriginal` (string) - textOriginal
      - `textOriginalSource` (string) - textOriginalSource
      - `textModified` (string) - textModified
      - `deletedAt` (string) - deletedAt
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **POST   /transcripts/{transcriptID}/markDeleted** - Soft delete a transcript

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Required**: modifiedCount, acknowledged
    **Properties**:
      - `modifiedCount` (number) (required) - Number of documents modified
      - `acknowledged` (boolean) (required) - Whether the operation was acknowledged

- **POST   /transcripts/{transcriptID}/markUndeleted** - Restore a soft-deleted transcript

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Required**: modifiedCount, acknowledged
    **Properties**:
      - `modifiedCount` (number) (required) - Number of documents modified
      - `acknowledged` (boolean) (required) - Whether the operation was acknowledged


### Transcript  Utterances
- **GET    /transcripts/{transcriptID}/utterances** - List all utterances for a transcript

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **GET    /transcripts/{transcriptID}/utterances/active** - List active utterances for a transcript

  **Schema Details:**
  **Response 200:**
    **Type**: array

- **POST   /transcripts/{transcriptID}/utterances/new** - Create utterances for a transcript (batch)

  **Schema Details:**
  **Request Body:**
    **Type**: array
  **Response 201:**
    **Type**: array

- **POST   /transcripts/{transcriptID}/utterances/{utteranceID}/update** - Update an utterance

  **Schema Details:**
  **Request Body:**
    **Type**: object
    **Properties**:
      - `speakerOriginal` (string) - speakerOriginal
      - `textOriginal` (string) - textOriginal
      - `startMS` (number) - startMS
      - `endMS` (number) - endMS
      - `confidence` (number) - confidence
      - `segmentIndex` (number) - segmentIndex
      - `speakerModified` (string) - speakerModified
      - `textModified` (string) - textModified
      - `textOriginalSource` (string) - textOriginalSource
      - `textOriginalAt` (string) - textOriginalAt
  **Response 200:**
    **Type**: object
    **Properties**:
      - `_id` (string) - _id
      - `transcriptID` (string) - transcriptID
      - `speakerOriginal` (string) - speakerOriginal
      - `textOriginal` (string) - textOriginal
      - `startMS` (number) - startMS
      - `endMS` (number) - endMS
      - `confidence` (number) - confidence
      - `segmentIndex` (number) - segmentIndex
      - `speakerModified` (string) - speakerModified
      - `textModified` (string) - textModified
      - `textOriginalSource` (string) - textOriginalSource
      - `textOriginalAt` (string) - textOriginalAt
      - `deletedAt` (string) - deletedAt
      - `createdAt` (string) - createdAt
      - `updatedAt` (string) - updatedAt

- **POST   /transcripts/{transcriptID}/utterances/{utteranceID}/markDeleted** - Soft delete an utterance

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Required**: modifiedCount, acknowledged
    **Properties**:
      - `modifiedCount` (number) (required) - Number of documents modified
      - `acknowledged` (boolean) (required) - Whether the operation was acknowledged

- **POST   /transcripts/{transcriptID}/utterances/{utteranceID}/markUndeleted** - Restore a soft-deleted utterance

  **Schema Details:**
  **Response 200:**
    **Type**: object
    **Required**: modifiedCount, acknowledged
    **Properties**:
      - `modifiedCount` (number) (required) - Number of documents modified
      - `acknowledged` (boolean) (required) - Whether the operation was acknowledged


## Integration Notes
- All API calls should follow the OpenAPI specification
- Request/response schemas are defined in the OpenAPI spec
- Error responses follow the documented error format
- Admin endpoints require Bearer authentication
- Customer session endpoints support Auth0 integration

---
*This file was automatically generated from the OpenAPI specification*