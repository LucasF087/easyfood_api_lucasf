// Camada Service
// Responsabilidade: concentrar as regras e operações relacionadas a
// restaurantes. Não conhece req/res — não depende de HTTP.
//
// Regras de posse (ownership):
//   - quem cadastra vira dono do restaurante (Restaurant.userId)
//   - só o dono pode alterar ou excluir
//   - restaurantes sem dono (userId nulo: os do seed e os cadastrados antes de
//     existir o vínculo) não podem ser alterados nem excluídos pela API

const prisma = require("../../database/prisma");
const notifications = require("../notifications/notification.service");
const { notFound, forbidden } = require("../../shared/http-error");

async function listRestaurants() {
  return prisma.restaurant.findMany({
    orderBy: { id: "asc" }
  });
}

async function getRestaurant(id) {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id }
  });

  if (!restaurant) {
    throw notFound("Restaurante não encontrado");
  }

  return restaurant;
}

// Carrega o restaurante e confirma que o usuário autenticado é o dono.
// 404 quando não existe, 403 quando existe mas é de outra pessoa.
async function getOwnedRestaurant(id, user) {
  const restaurant = await getRestaurant(id);

  if (restaurant.userId === null || restaurant.userId === undefined) {
    throw forbidden(
      "Este restaurante não tem dono registrado e não pode ser alterado pela API"
    );
  }

  if (Number(restaurant.userId) !== Number(user.id)) {
    throw forbidden("Você só pode alterar restaurantes cadastrados por você");
  }

  return restaurant;
}

async function createRestaurant(data, owner) {
  const restaurant = await prisma.restaurant.create({
    data: {
      name: data.name,
      category: data.category,
      rating: data.rating,
      userId: owner?.id ?? null
    }
  });

  // Cenário da ADR-005: comunicação direta, aqui simulada com log.
  notifications.notifyRestaurantCreated({ restaurant, owner });

  return restaurant;
}

async function updateRestaurant(id, data, user) {
  await getOwnedRestaurant(id, user);

  // `data.rating` chega undefined quando o PUT não informa a nota, e o Prisma
  // ignora campos undefined: o valor atual é mantido.
  return prisma.restaurant.update({
    where: { id },
    data: {
      name: data.name,
      category: data.category,
      rating: data.rating
    }
  });
}

async function deleteRestaurant(id, user) {
  await getOwnedRestaurant(id, user);

  await prisma.restaurant.delete({
    where: { id }
  });
}

module.exports = {
  listRestaurants,
  getRestaurant,
  getOwnedRestaurant,
  createRestaurant,
  updateRestaurant,
  deleteRestaurant
};
