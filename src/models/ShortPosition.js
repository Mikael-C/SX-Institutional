const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ShortPosition = sequelize.define('ShortPosition', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    asset: {
      type: DataTypes.STRING,
      allowNull: false
    },
    amount: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false
    },
    entryPrice: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false
    },
    currentPrice: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false
    },
    profit: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false,
      defaultValue: 0
    },
    status: {
      type: DataTypes.ENUM('Open', 'Closed'),
      defaultValue: 'Open'
    },
    loanId: {
      type: DataTypes.UUID,
      allowNull: true
    }
  }, {
    tableName: 'short_positions',
    indexes: [
      { fields: ['userId'] },
      { fields: ['status'] },
      { fields: ['asset'] },
      { fields: ['loanId'] }
    ]
  });

  return ShortPosition;
};
