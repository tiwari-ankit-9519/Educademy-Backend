const getTokenFromHeader = (req) => {
  const bearerHeader = req.headers["authorization"];
  if (typeof bearerHeader !== "undefined") {
    const bearer = bearerHeader.split(" ");
    const bearerToken = bearer[1];
    return bearerToken;
  } else {
    return null;
  }
};

export default getTokenFromHeader;
