const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Swap = sequelize.define('Swap', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    tokenIn: {
      type: DataTypes.STRING,
      allowNull: false
    },
    tokenOut: {
      type: DataTypes.STRING,
      allowNull: false
    },
    amountIn: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false
    },
    amountOut: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false
    },
    source: {
      type: DataTypes.STRING,
      allowNull: false
    },
    txHash: {
      type: DataTypes.STRING,
      allowNull: true
    },
    chain: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'Hoodi'
    }
  }, {
    tableName: 'swaps',
    indexes: [
      { fields: ['userId'] },
      { fields: ['chain'] },
      { fields: ['tokenIn', 'tokenOut'] },
      { fields: ['txHash'] }
    ]
  });

  return Swap;
};
