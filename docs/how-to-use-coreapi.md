# How to Use the CoreAPI (Client Primer)

This document explains how to interact with the CDS CoreAPI from client applications. The CoreAPI is accessed through a Socket.IO connection to the admin server, which proxies requests to the underlying CoreAPI service.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Establishing a Connection](#establishing-a-connection)
3. [Making Requests](#making-requests)
4. [Available Methods](#available-methods)
5. [Response Format](#response-format)
6. [Error Handling](#error-handling)
7. [Code Examples](#code-examples)

---

## Architecture Overview

```
┌─────────────────┐      Socket.IO       ┌─────────────────┐      HTTP        ┌─────────────────┐
│   Client App    │ ─────────────────▶   │  Admin Server   │ ──────────────▶  │    CoreAPI      │
│  (Browser/JS)   │ ◀─────────────────   │  (Node.js)      │ ◀──────────────  │   (Fastify)     │
└─────────────────┘                      └─────────────────┘                  └─────────────────┘
```

The client communicates with the admin server via Socket.IO. The admin server's `socketIOHandlerCoreAPIRequest.js` handles CoreAPI requests, translates them into HTTP calls to the CoreAPI, normalizes the responses, and returns them to the client.

---

## Establishing a Connection

### Prerequisites

1. A valid authentication token (Auth0)
2. Socket.IO client library

### Connection Setup

```javascript
import { io } from 'socket.io-client';

const socket = io({
  autoConnect: true,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: Infinity,
  withCredentials: true,
  path: '/socket.io',  // Adjust based on your server config
  auth: {
    token: 'YOUR_AUTH0_TOKEN',
    area: 'admin'  // or appropriate area
  }
});

// Listen for successful authentication
socket.on('cdsAuthenticated', (sessionInfo) => {
  console.log('Connected and authenticated!', sessionInfo);
});

// Listen for errors
socket.on('cdsError', (err) => {
  console.error('CDS Error:', err);
});
```

---

## Making Requests

All CoreAPI requests are made using the `cdsRequest` event with a specific payload structure:

```javascript
socket.emit('cdsRequest', {
  scope: 'coreapi',           // Always 'coreapi' for CoreAPI requests
  method: 'METHOD_NAME',      // The method to call (see Available Methods)
  args: {                     // Arguments specific to the method
    customerID: '...',
    // ... other method-specific arguments
  }
}, (response, error) => {
  // Callback receives the response or error
});
```

### Helper Function

It's recommended to create a wrapper function for cleaner code:

```javascript
function coreAPIRequest(method, args = {}) {
  return new Promise((resolve, reject) => {
    if (!socket || !socket.connected) {
      return reject(new Error('Socket not connected'));
    }
    
    socket.emit('cdsRequest', {
      scope: 'coreapi',
      method,
      args,
      _timestamp: Date.now()  // Prevent caching
    }, (response, error) => {
      if (error) {
        reject(error);
      } else {
        resolve(response);
      }
    });
  });
}

// Usage
const customers = await coreAPIRequest('getAllCustomers');
```

---

## Available Methods

### Customer Methods

| Method | Arguments | Description |
|--------|-----------|-------------|
| `getAllCustomers` | *none* | Get all customers (admin only) |
| `getCustomerByID` | `{ customerID }` | Get a specific customer's details |
| `getGlobalConfig` | *none* | Get global configuration (DEFAULT_ROLES, ALL_SERVICES_WITH_AUTH_AREAS, etc.) |
| `getCustomerServices` | `{ customerID }` | Get services enabled for a customer |
| `updateCustomerServices` | `{ customerID, services: [] }` | Update customer's enabled services |
| `updateCustomerRoles` | `{ customerID, roles: [] }` | Create, update, or delete customer roles |

### Contact Methods

| Method | Arguments | Description |
|--------|-----------|-------------|
| `getContactsByCustomerID` | `{ customerID }` | Get all contacts for a customer |
| `createContact` | `{ customerID, body: {...} }` | Create a new contact |
| `updateContact` | `{ id, customerID, body: {...} }` | Update an existing contact |

### Contact Credentials

| Method | Arguments | Description |
|--------|-----------|-------------|
| `getContactActiveCredentials` | `{ id, customerID }` | Get active credentials for a contact |
| `createContactCredential` | `{ id, customerID, body: {...} }` | Add a credential to a contact |
| `updateContactCredential` | `{ id, credentialId, customerID, body: {...} }` | Update a contact's credential |
| `deleteContactCredential` | `{ id, credentialId, customerID }` | Delete a contact's credential |

### Organization Unit Methods

| Method | Arguments | Description |
|--------|-----------|-------------|
| `getOrganizationUnitsByCustomerID` | `{ customerID }` | Get all org units for a customer |
| `getOrganizationUnitByID` | `{ id, customerID }` | Get a specific org unit |
| `createOrganizationUnit` | `{ customerID, body: { name, type, ... } }` | Create a new org unit |
| `updateOrganizationUnit` | `{ id, customerID, body: {...} }` | Update an org unit |

### Organization Unit Sub-Levels

| Method | Arguments | Description |
|--------|-----------|-------------|
| `getOrganizationUnitSubLevels` | `{ id, customerID }` | Get sub-levels for an org unit |
| `createOrganizationUnitSubLevel` | `{ id, customerID, body: { name, levelOrdinal } }` | Create a sub-level |
| `updateOrganizationUnitSubLevel` | `{ id, levelID, customerID, body: {...} }` | Update a sub-level |
| `markDeletedOrganizationUnitSubLevel` | `{ id, levelID, customerID, isDeleted }` | Soft delete/restore a sub-level |

### Organization Unit Seats

| Method | Arguments | Description |
|--------|-----------|-------------|
| `getOrganizationUnitSeatsByOrganizationUnitID` | `{ organizationUnitID, customerID }` | Get seats for an org unit |
| `createOrganizationUnitSeat` | `{ customerID, body: {...} }` | Create a new seat |
| `updateOrganizationUnitSeat` | `{ id, customerID, body: {...} }` | Update a seat |
| `markDeletedOrganizationUnitSeat` | `{ id, customerID }` | Soft delete a seat |
| `markUndeletedOrganizationUnitSeat` | `{ id, customerID }` | Restore a soft-deleted seat |

### Data Unit Methods

| Method | Arguments | Description |
|--------|-----------|-------------|
| `getActiveDataUnitsByCustomerID` | `{ customerID, scopeArea?, scopeClass? }` | Get active data units (with optional filters) |
| `createDataUnit` | `{ customerID, body: { scopeArea, scopeClass, value, ... } }` | Create a new data unit |
| `updateDataUnit` | `{ id, customerID, body: {...} }` | Update a data unit |
| `setDataUnitOrderID` | `{ id, customerID, beforeOrderID?, afterOrderID? }` | Reorder a data unit using fractional indexing |

### Scoped Counter Methods

| Method | Arguments | Description |
|--------|-----------|-------------|
| `listScopedCounters` | `{ customerID?, scope? }` | List scoped counters |
| `createScopedCounter` | `{ customerID, scope, body: {...} }` | Create a new scoped counter |
| `updateScopedCounter` | `{ counterID, body: {...} }` | Update counter configuration |
| `advanceScopedCounter` | `{ counterID, body: { advanceTo?, advanceBy?, reason? } }` | Advance counter value |
| `incrementScopedCounter` | `{ customerID?, body: { scope, idempotencyKey, claimTarget: { area, id } } }` | Increment counter (idempotent) |

---

## Response Format

Successful responses follow this structure:

```javascript
{
  statusCode: 200,  // HTTP status code (200, 201, etc.)
  result: {...}     // The actual data (normalized by the handler)
}
```

### Normalized Response Objects

The handler normalizes responses to consistent field names. For example, `_id` from MongoDB is mapped to `id` in most responses.

**Customer Response:**
```javascript
{
  customerID: "...",
  customerName: "...",
  legacyCustomerID: "...",
  roles: [...],
  services: [...]
}
```

**Contact Response:**
```javascript
{
  id: "...",
  customerID: "...",
  nameFirst: "...",
  nameLast: "...",
  emailPrimary: "...",
  phones: [...],
  credentials: [...],
  // ... other fields
}
```

**Data Unit Response:**
```javascript
{
  id: "...",
  customerID: "...",
  scopeArea: "...",
  scopeClass: "...",
  scopeID: "...",
  orderID: "...",
  parentID: "...",
  value: {...},
  dateStart: "...",
  dateEnd: "...",
  deletedAt: null,
  createdAt: "...",
  updatedAt: "..."
}
```

---

## Error Handling

Errors can come in two forms:

### 1. Callback Error Parameter

```javascript
socket.emit('cdsRequest', payload, (response, error) => {
  if (error) {
    // Handle error - usually a string like 'MISSING_CUSTOMERID'
    console.error('Request failed:', error);
    return;
  }
  // Handle success
});
```

### 2. Response with Non-2xx Status Code

```javascript
socket.emit('cdsRequest', payload, (response, error) => {
  if (!response || response.statusCode < 200 || response.statusCode >= 300) {
    console.error('API returned error:', response);
    return;
  }
  // Handle success
});
```

### Common Error Codes

| Error Code | Description |
|------------|-------------|
| `MISSING_CUSTOMERID` | customerID argument is required but missing |
| `MISSING_CONTACT_ID` | Contact ID is required but missing |
| `MISSING_REQUIRED_FIELDS` | Required fields are missing (details in error) |
| `NOT_HANDLED_CORE_API_METHOD` | The method name is not recognized |
| `NOT_CONNECTED` | Socket is not connected |
| `FETCH_FAILED` | The underlying HTTP request to CoreAPI failed |

---

## Code Examples

### Example 1: Fetching All Customers

```javascript
function fetchCustomers(socketEmit, setCustomers, setError) {
  socketEmit('cdsRequest', {
    scope: 'coreapi',
    method: 'getAllCustomers'
  }, (resp, err) => {
    if (err) {
      setError(typeof err === 'string' ? err : JSON.stringify(err));
      return;
    }
    if (resp && resp.statusCode === 200) {
      setCustomers(resp.result);
    }
  });
}
```

### Example 2: Creating a Contact

```javascript
function createContact(socketEmit, customerID, contactData, onSuccess, onError) {
  socketEmit('cdsRequest', {
    scope: 'coreapi',
    method: 'createContact',
    args: {
      customerID,
      body: {
        nameFirst: contactData.firstName,
        nameLast: contactData.lastName,
        emailPrimary: contactData.email,
        phones: contactData.phones || [],
        tags: contactData.tags || []
      }
    }
  }, (resp, err) => {
    if (err) {
      onError(err);
      return;
    }
    if (resp && (resp.statusCode === 200 || resp.statusCode === 201)) {
      onSuccess(resp.result);
    } else {
      onError('Failed to create contact');
    }
  });
}
```

### Example 3: Updating Customer Roles

```javascript
function updateCustomerRoles(socketEmit, customerID, roles, onSuccess, onError) {
  // Roles array should contain objects with:
  // - _id (for existing roles to update/keep)
  // - name (required)
  // - isUseDefault (optional boolean)
  // Roles without _id will be created
  // Existing roles not in the array will be deleted
  
  socketEmit('cdsRequest', {
    scope: 'coreapi',
    method: 'updateCustomerRoles',
    args: {
      customerID,
      roles: roles.map(r => ({
        _id: r._id || r.id,
        name: r.name,
        isUseDefault: !!r.isUseDefault
      }))
    }
  }, (resp, err) => {
    if (err) {
      onError(err);
      return;
    }
    if (resp && resp.statusCode === 200) {
      onSuccess(resp.result);
    }
  });
}
```

### Example 4: Creating and Reordering Data Units

```javascript
// Create a data unit
function createDataUnit(socketEmit, customerID, dataUnit) {
  return new Promise((resolve, reject) => {
    socketEmit('cdsRequest', {
      scope: 'coreapi',
      method: 'createDataUnit',
      args: {
        customerID,
        body: {
          scopeArea: dataUnit.scopeArea,
          scopeClass: dataUnit.scopeClass,
          value: dataUnit.value,
          parentID: dataUnit.parentID || null,
          dateStart: dataUnit.dateStart || null,
          dateEnd: dataUnit.dateEnd || null
        }
      }
    }, (resp, err) => {
      if (err) reject(err);
      else if (resp && (resp.statusCode === 200 || resp.statusCode === 201)) {
        resolve(resp.result);
      } else {
        reject('Failed to create data unit');
      }
    });
  });
}

// Reorder a data unit (move it between two other items)
function reorderDataUnit(socketEmit, id, customerID, beforeOrderID, afterOrderID) {
  return new Promise((resolve, reject) => {
    socketEmit('cdsRequest', {
      scope: 'coreapi',
      method: 'setDataUnitOrderID',
      args: {
        id,
        customerID,
        beforeOrderID,  // orderID of item that should come before this one (null if first)
        afterOrderID    // orderID of item that should come after this one (null if last)
      }
    }, (resp, err) => {
      if (err) reject(err);
      else if (resp && resp.statusCode === 200) {
        resolve(resp.result);
      } else {
        reject('Failed to reorder data unit');
      }
    });
  });
}
```

### Example 5: Working with Scoped Counters

```javascript
// Create a counter with yearly reset
function createYearlyCounter(socketEmit, customerID, scope) {
  return new Promise((resolve, reject) => {
    socketEmit('cdsRequest', {
      scope: 'coreapi',
      method: 'createScopedCounter',
      args: {
        customerID,
        scope,
        body: {
          customerID,
          scope,
          resetPolicy: 'YEARLY',
          resetRolloverDayOfYear: 1,  // Reset on Jan 1
          resetTimezone: 'America/New_York',
          initialCounter: 0
        }
      }
    }, (resp, err) => {
      if (err) reject(err);
      else if (resp && resp.statusCode === 201) {
        resolve(resp.result);
      } else {
        reject('Failed to create counter');
      }
    });
  });
}

// Increment counter (idempotent - safe to retry)
function incrementCounter(socketEmit, scope, idempotencyKey, claimArea, claimId, customerID) {
  return new Promise((resolve, reject) => {
    socketEmit('cdsRequest', {
      scope: 'coreapi',
      method: 'incrementScopedCounter',
      args: {
        customerID,
        body: {
          scope,
          idempotencyKey,
          claimTarget: {
            area: claimArea,
            id: claimId
          }
        }
      }
    }, (resp, err) => {
      if (err) reject(err);
      else if (resp && resp.statusCode === 200) {
        resolve(resp.result);  // { at, currentCounter, currentPeriodKey }
      } else {
        reject('Failed to increment counter');
      }
    });
  });
}
```

---

## React Hook Pattern

For React applications, here's a recommended pattern using context and hooks:

```javascript
import React, { useContext, useState, useCallback } from 'react';
import { SocketContext } from './context/SocketIOContext';

// Custom hook for CoreAPI requests
function useCoreAPI() {
  const { socketEmit } = useContext(SocketContext) || {};
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const request = useCallback(async (method, args = {}) => {
    if (!socketEmit) {
      throw new Error('Socket not ready');
    }

    setIsLoading(true);
    setError(null);

    return new Promise((resolve, reject) => {
      socketEmit('cdsRequest', {
        scope: 'coreapi',
        method,
        args,
        _timestamp: Date.now()
      }, (resp, err) => {
        setIsLoading(false);
        
        if (err) {
          setError(err);
          reject(err);
          return;
        }
        
        if (!resp || resp.statusCode < 200 || resp.statusCode >= 300) {
          const errorMsg = 'Request failed';
          setError(errorMsg);
          reject(errorMsg);
          return;
        }
        
        resolve(resp.result);
      });
    });
  }, [socketEmit]);

  return { request, isLoading, error, setError };
}

// Usage in a component
function CustomerList() {
  const { request, isLoading, error } = useCoreAPI();
  const [customers, setCustomers] = useState([]);

  useEffect(() => {
    request('getAllCustomers')
      .then(setCustomers)
      .catch(console.error);
  }, [request]);

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  
  return (
    <ul>
      {customers.map(c => (
        <li key={c.customerID}>{c.customerName}</li>
      ))}
    </ul>
  );
}
```

---

## Additional Resources

- **Full API Documentation**: See `API_DOCUMENTATION-COREAPI.md` for complete endpoint documentation
- **OpenAPI Spec**: Available at `/v1/documentation/json` on the CoreAPI server
- **Server Handler Source**: `server/socketIOHandlerCoreAPIRequest.js` contains the complete method implementations

---

*Last updated: January 2026*
