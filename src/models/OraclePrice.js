const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const OraclePrice = sequelize.define('OraclePrice', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    asset: {
      type: DataTypes.STRING,
      allowNull: false
    },
    feedId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    price: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false
    },
    chain: {
      type: DataTypes.STRING,
      allowNull: false
    },
    timestamp: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    isDisputed: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    }
  }, {
    tableName: 'oracle_prices',
    indexes: [
      { fields: ['asset'] },
      { fields: ['chain'] },
      { fields: ['feedId'] },
      { fields: ['asset', 'chain'] },
      { fields: ['isDisputed'] }
    ]
  });

  return OraclePrice;
};
