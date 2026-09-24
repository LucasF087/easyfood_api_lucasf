// Helper de teste: Prisma em memória
//
// Ideia: trocar APENAS o módulo src/database/prisma.js por um dublê em
// memória, usando o require.cache do Node. Tudo o que está acima dele —
// Express, rotas, middlewares, validação, bcrypt e JWT — continua sendo o
// código real, executado de verdade.
//
// Por que require.cache e não uma biblioteca de mock: o projeto não ganha
// nenhuma dependência nova, e os testes rodam com `node --test`, que já vem
// no Node 20+.
//
// Como funciona: quando um módulo é carregado, o Node guarda o resultado em
// require.cache, indexado pelo caminho absoluto do arquivo. Se a entrada já
// existir ANTES do primeiro require, o Node devolve o que está lá e nunca
// executa o arquivo original — que é onde o PrismaClient seria instanciado.
//
// Fidelidade ao Prisma de verdade:
//   - campos Decimal (rating) voltam como string com uma casa decimal, que é
//     como o Prisma serializa Decimal em JSON;
//   - violação de índice único lança um erro com code "P2002";
//   - update/delete em registro inexistente lançam "P2025".

const PRISMA_MODULE_PATH = require.resolve("../../src/database/prisma.js");

function prismaError(code, message, meta) {
  const error = new Error(message);
  error.code = code;
  error.name = "PrismaClientKnownRequestError";
  error.meta = meta;
  return error;
}

// Emula numeric(2,1) do PostgreSQL + Decimal do Prisma:
// o valor volta como string com exatamente uma casa decimal.
function toDecimal(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return Number(value).toFixed(1);
}

function matches(record, where) {
  return Object.entries(where).every(([key, value]) => record[key] === value);
}

function createPrismaStub(seed = {}) {
  const state = {
    users: [],
    restaurants: [],
    nextUserId: 1,
    nextRestaurantId: 1,
    // Permite simular uma falha inesperada de banco (para testar o 500).
    failNextWith: null
  };

  function checkInjectedFailure() {
    if (state.failNextWith) {
      const error = state.failNextWith;
      state.failNextWith = null;
      throw error;
    }
  }

  const stub = {
    user: {
      async create({ data }) {
        checkInjectedFailure();

        if (state.users.some((user) => user.email === data.email)) {
          throw prismaError(
            "P2002",
            "Unique constraint failed on the fields: (`email`)",
            { target: ["email"] }
          );
        }

        const user = {
          id: state.nextUserId++,
          name: data.name,
          email: data.email,
          password: data.password
        };

        state.users.push(user);
        return { ...user };
      },

      async findUnique({ where }) {
        checkInjectedFailure();
        const found = state.users.find((user) => matches(user, where));
        return found ? { ...found } : null;
      },

      async findMany() {
        checkInjectedFailure();
        return state.users.map((user) => ({ ...user }));
      }
    },

    restaurant: {
      async findMany() {
        checkInjectedFailure();
        return state.restaurants
          .slice()
          .sort((a, b) => a.id - b.id)
          .map((restaurant) => ({ ...restaurant }));
      },

      async findUnique({ where }) {
        checkInjectedFailure();
        const found = state.restaurants.find((restaurant) => matches(restaurant, where));
        return found ? { ...found } : null;
      },

      async create({ data }) {
        checkInjectedFailure();

        const restaurant = {
          id: state.nextRestaurantId++,
          name: data.name,
          category: data.category ?? null,
          rating: toDecimal(data.rating),
          userId: data.userId ?? null
        };

        state.restaurants.push(restaurant);
        return { ...restaurant };
      },

      async update({ where, data }) {
        checkInjectedFailure();

        const index = state.restaurants.findIndex((restaurant) => matches(restaurant, where));

        if (index === -1) {
          throw prismaError("P2025", "An operation failed because it depends on one or more records that were required but not found.");
        }

        const current = state.restaurants[index];

        const updated = {
          ...current,
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.category !== undefined ? { category: data.category } : {}),
          ...(data.rating !== undefined ? { rating: toDecimal(data.rating) } : {}),
          ...(data.userId !== undefined ? { userId: data.userId } : {})
        };

        state.restaurants[index] = updated;
        return { ...updated };
      },

      async delete({ where }) {
        checkInjectedFailure();

        const index = state.restaurants.findIndex((restaurant) => matches(restaurant, where));

        if (index === -1) {
          throw prismaError("P2025", "An operation failed because it depends on one or more records that were required but not found.");
        }

        const [removed] = state.restaurants.splice(index, 1);
        return { ...removed };
      },

      async createMany({ data }) {
        checkInjectedFailure();
        for (const item of data) {
          await stub.restaurant.create({ data: item });
        }
        return { count: data.length };
      }
    },

    async $disconnect() {},

    // ---- utilidades só de teste (prefixo __ para não confundir com o Prisma)
    __state: state,

    __reset(nextSeed = {}) {
      state.users = [];
      state.restaurants = [];
      state.nextUserId = 1;
      state.nextRestaurantId = 1;
      state.failNextWith = null;
      stub.__seed(nextSeed);
    },

    __seed({ users = [], restaurants = [] } = {}) {
      for (const user of users) {
        state.users.push({ ...user, id: user.id ?? state.nextUserId++ });
        state.nextUserId = Math.max(state.nextUserId, (user.id ?? 0) + 1);
      }

      for (const restaurant of restaurants) {
        const id = restaurant.id ?? state.nextRestaurantId++;
        state.restaurants.push({
          id,
          name: restaurant.name,
          category: restaurant.category ?? null,
          rating: toDecimal(restaurant.rating),
          userId: restaurant.userId ?? null
        });
        state.nextRestaurantId = Math.max(state.nextRestaurantId, id + 1);
      }
    },

    __failNextWith(error) {
      state.failNextWith = error;
    }
  };

  stub.__seed(seed);

  return stub;
}

// Coloca o dublê no require.cache antes que alguém carregue o módulo real.
function installPrismaStub(seed) {
  const stub = createPrismaStub(seed);

  require.cache[PRISMA_MODULE_PATH] = {
    id: PRISMA_MODULE_PATH,
    filename: PRISMA_MODULE_PATH,
    path: PRISMA_MODULE_PATH.replace(/\/[^/]+$/, ""),
    loaded: true,
    children: [],
    paths: [],
    exports: stub
  };

  return stub;
}

module.exports = {
  PRISMA_MODULE_PATH,
  createPrismaStub,
  installPrismaStub,
  toDecimal
};
