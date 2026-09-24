// Camada Controller
// Responsabilidade: receber a requisição HTTP, validar/normalizar a entrada,
// chamar o Service e devolver a resposta correta.
//
// Nenhum try/catch aqui: o Express 5 encaminha a rejeição de handlers async
// para o error handler central, que responde sempre em JSON.

const restaurantService = require("./restaurant.service");
const { validateRestaurant, validateId } = require("../../shared/validators");
const { badRequest } = require("../../shared/http-error");

function parseId(req) {
  const errors = [];
  const result = validateId(req.params.id, errors);

  if (errors.length > 0) {
    throw badRequest("Dados inválidos", errors);
  }

  return result.value;
}

// No PUT, a nota omitida mantém o valor atual; no POST ela vira 0.
function parseBody(req, { isUpdate = false } = {}) {
  const { data, errors } = validateRestaurant(req.body ?? {}, { isUpdate });

  if (errors.length > 0) {
    throw badRequest("Dados inválidos", errors);
  }

  return data;
}

async function list(req, res) {
  const restaurants = await restaurantService.listRestaurants();
  res.json(restaurants);
}

async function show(req, res) {
  const restaurant = await restaurantService.getRestaurant(parseId(req));
  res.json(restaurant);
}

async function create(req, res) {
  const data = parseBody(req);

  const restaurant = await restaurantService.createRestaurant(data, req.user);

  res.status(201).json(restaurant);
}

async function update(req, res) {
  const id = parseId(req);
  const data = parseBody(req, { isUpdate: true });

  const restaurant = await restaurantService.updateRestaurant(id, data, req.user);

  res.json(restaurant);
}

async function remove(req, res) {
  const id = parseId(req);

  await restaurantService.deleteRestaurant(id, req.user);

  res.status(204).end();
}

module.exports = { list, show, create, update, remove };
